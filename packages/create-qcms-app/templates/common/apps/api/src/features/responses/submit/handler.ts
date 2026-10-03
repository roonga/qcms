/**
 * Submit handler (task 020) - the audit boundary.
 *
 * `POST /sessions/{id}/submit` validates every visible-required answer through
 * the kernel (`prepareSubmission`, 009), locks the answer set under a content
 * hash, and - in **one transaction** - persists the lock, flips the session to
 * `submitted`, and writes the `response.submitted` outbox event. The single
 * transaction is the whole point (ARCHITECTURE §11 egress reliability): an
 * integration can never observe a submission that isn't durable, and a durable
 * submission can never miss its event (transactional outbox, at-least-once).
 *
 * A **transaction script** (R5): load state (`@roonga/qcms-db`) → call the kernel
 * (`prepareSubmission`) → persist. Invariants spanning rows go through the
 * kernel; the slice owns the transaction boundary (R3). Fetch-pure (R4): time
 * via `deps.clock`, no `node:*`.
 *
 * Security properties held here:
 *
 * - **Answer values are never logged** (SEC-8): the handler logs nothing that
 *   carries content; the kernel's error messages name ids only.
 * - **`contentHash` is the audit anchor** (009): the receipt returns it so any
 *   holder can re-derive and verify the locked set.
 * - **Hidden answers are excluded** (I6): the locked set and the webhook payload
 *   contain only visible questions' answers; the stale/hidden ones stay in the
 *   append-only ledger but never cross into the submission.
 * - **Silent anti-abuse flag**: a honeypot-filled or too-fast submit returns the
 *   *same* success-shaped receipt as a clean one while flagging the row and
 *   withholding its outbox event - the tell never leaks to the caller.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  type AnswerMap,
  type FormDefinition,
  type FrozenSnapshot,
  parseSessionId,
  prepareSubmission,
  type QuestionId,
  type QuestionVersionRecord,
  type SessionId,
  SNAPSHOT_SCHEMA_VERSION,
  type SubmissionError,
  stepQuestionRefs,
} from "@roonga/qcms-core";
import {
  enqueue,
  getForm,
  getFormVersion,
  getQuestionVersion,
  getSession,
  getSubmission,
  insertSubmission,
  latestAnswers,
  markSubmitted,
  type SessionRow,
} from "@roonga/qcms-db";
import { sql } from "drizzle-orm";
import type { Context } from "hono";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { FlagReason } from "../flag-reasons.js";
import { loadRosters } from "../roster.js";
import { parseSemanticsVersion } from "../semantics-version.js";
import { authenticateSession } from "../session-token.js";
// Type-only (erased at runtime, so no import cycle with route.ts).
import type { submitRoute } from "./route.js";
import type { SubmitResponse } from "./schema.js";

/** The outbox event type for a completed submission (ARCHITECTURE §5.3, §11). */
const RESPONSE_SUBMITTED = "response.submitted" as const;

// --- typed failures (envelope codes the portal keys off, 029) ---------------

const fail = {
  sessionNotFound: (): ApiError => new ApiError("SESSION_NOT_FOUND", 404, "No such session"),
  sessionExpired: (): ApiError => new ApiError("SESSION_EXPIRED", 409, "This session has expired"),
  nothingToSubmit: (): ApiError =>
    new ApiError("NOTHING_TO_SUBMIT", 409, "This session has no answers to submit"),
  crossSession: (): ApiError =>
    new ApiError("unauthorized", 401, "Session token does not match this session"),
} as const;

// The enum-bearing `sessions`, `forms`, and `question_versions` rows are
// hand-authored and sound across @roonga/qcms-db's package boundary (issue #5), so this
// slice consumes `SessionRow` and the inferred `forms`/`question_versions` rows
// directly - no local view or cast for the row types. (`forms.min_submit_ms` is
// the per-form abuse floor this slice reads, task 026.)

/**
 * The pinned snapshot for a submission, shaped as the kernel's `FrozenSnapshot`
 * so `prepareSubmission` re-validates against the exact frozen definitions the
 * session is pinned to (I1/I4). Reconstructed from the `form_versions` row plus
 * each pinned `question_versions` row - a missing row is an internal
 * inconsistency in a *published* snapshot (I2), not client input, so it throws.
 */
async function loadFrozenSnapshot(deps: Deps, session: SessionRow): Promise<FrozenSnapshot> {
  const version = await getFormVersion(
    deps.databases.forRequest().exec,
    session.formId,
    session.formVersion,
  );
  if (version === undefined) {
    throw new Error(
      `submit: session "${session.sessionId}" is pinned to form ${session.formId}@${String(session.formVersion)} which does not exist`,
    );
  }
  const definition: FormDefinition = version.definition;

  const questions: QuestionVersionRecord[] = [];
  for (const step of definition.steps) {
    for (const ref of stepQuestionRefs(step)) {
      const record = await getQuestionVersion(
        deps.databases.forRequest().exec,
        ref.questionId,
        ref.version,
      );
      if (record === undefined) {
        throw new Error(
          `submit: pinned question ${ref.questionId}@${String(ref.version)} is missing for form ${session.formId}@${String(session.formVersion)} (snapshot not self-contained)`,
        );
      }
      questions.push({
        questionId: ref.questionId,
        version: ref.version,
        definition: record.definition,
      });
    }
  }

  return {
    definition,
    questions,
    // The evaluator gates on `semanticsVersion` (I7); the stored stamp is text.
    // A published version always stamps the semantics it was validated under,
    // so a stamp that is not a decimal integer is a corrupt row, not an old
    // snapshot: it is refused here instead of reaching the gate as `NaN` and
    // being reported as a failed submission sweep (issue #723). A stamp that
    // reads as a number this build does not implement is unchanged - the kernel
    // gate still reports it through `prepareSubmission`.
    semanticsVersion: parseSemanticsVersion(version.semanticsVersion),
    // Unused by the submission sweep; stamped for shape completeness.
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };
}

/** Authenticate and confirm the token binds the `id` in the path (SEC-2 §3). */
async function authorizedSessionId(c: Context<ApiEnv>, deps: Deps, id: string): Promise<SessionId> {
  const authedSessionId = await authenticateSession(c, deps);
  if (authedSessionId !== id) throw fail.crossSession();
  const parsed = parseSessionId(id);
  if (!parsed.ok) throw fail.crossSession();
  return parsed.value;
}

/** The receipt for a stored submission row (same shape, clean or flagged). */
function receiptFrom(row: { submittedAt: Date; contentHash: string }): SubmitResponse {
  return { submittedAt: row.submittedAt.toISOString(), contentHash: row.contentHash };
}

/**
 * Anti-abuse hooks (finalized in 026). Both are **silent**: a triggered signal
 * returns a {@link FlagReason} that flags the submission and withholds its
 * webhook event, while the response stays the usual success shape (the tell
 * never leaks - SECURITY). `minTimeFloorMs` is the *effective* floor for this
 * form (the per-form `min_submit_ms` override, else the config default); `0`
 * disables the min-time check. Returns the reason, or `undefined` when clean.
 */
function detectAbuse(
  deps: Deps,
  session: SessionRow,
  body: Record<string, unknown>,
  minTimeFloorMs: number,
): FlagReason | undefined {
  const { honeypotField } = deps.config.antiAbuse;

  // A legitimate client leaves the decoy empty/absent. A string value counts as
  // filled only when non-blank; any non-string, non-null value (a bot sending a
  // number/boolean/object) is filled by its mere presence.
  const honeypot = body[honeypotField];
  const honeypotFilled =
    typeof honeypot === "string"
      ? honeypot.trim() !== ""
      : honeypot !== undefined && honeypot !== null;
  if (honeypotFilled) return FlagReason.HONEYPOT;

  if (minTimeFloorMs > 0) {
    const elapsedMs = deps.clock.now().getTime() - session.createdAt.getTime();
    if (elapsedMs < minTimeFloorMs) return FlagReason.MIN_TIME;
  }

  return undefined;
}

/** Split the kernel's sweep errors into the client-safe 422 detail (ids only). */
function toSubmissionDetail(errors: readonly SubmissionError[]): {
  missingRequired: QuestionId[];
  errors: readonly SubmissionError[];
} {
  const missingRequired = errors
    .filter(
      (e): e is Extract<SubmissionError, { code: "MISSING_REQUIRED" }> =>
        e.code === "MISSING_REQUIRED",
    )
    .map((e) => e.questionId);
  return { missingRequired, errors };
}

/**
 * `POST /sessions/{id}/submit`. Session-token authed. Ordering: authorize →
 * load session (idempotent on `submitted`, reject `expired`/`created`) → one
 * transaction (advisory lock, **then** the ledger read and the `prepareSubmission`
 * sweep, then insert lock, mark submitted, enqueue unless flagged).
 *
 * **The sweep is INSIDE the lock, and that is the fix for issue #968.** It used to run
 * before the transaction opened: the ledger was read, swept and hashed, and only then
 * was the lock taken. A retraction committed in that window was in the ledger and not
 * in the sealed `lockedAnswers` or its `contentHash`, so the two records of one
 * response disagreed - the ledger recording a clear the submission did not reflect.
 * The reviewer who found it read correctly that this could not seal an EMPTY required
 * answer, because the locked set matched the snapshot that had been swept; what it
 * could do is leave the audit trail and the audit anchor describing different answer
 * sets, which is the one thing a submission exists to make impossible.
 *
 * Repetition amplifies it rather than creating it: the window is multiplied by the
 * number of fields a step posts, and the no-JS path posts a whole step at once (Q20,
 * ADR-43), which is why closing it is a deliverable of task 073 rather than a
 * dependency scheduled elsewhere.
 *
 * **What moved and what did not.** The read and the sweep moved inside the existing
 * transaction, after the existing advisory lock. Nothing else changed: the status gates
 * above are still unlocked reads (they are re-checked under the lock, as they always
 * were), the abuse decision is still pure over the validated submission, and the
 * insert, the status flip and the outbox enqueue are still one transaction with the
 * sweep they were computed from. The 422 is now thrown from inside the transaction,
 * which rolls it back and writes nothing - the same envelope the caller saw before,
 * because a sweep failure never wrote anything anyway.
 *
 * **The roster travels with the sweep** (ADR-42): a removed instance's answers are
 * excluded from the locked set exactly as a hidden question's are, and a group below
 * `min` or above `max` is refused with `REPEAT_COUNT_OUT_OF_RANGE`. Deriving it inside
 * the lock is the same requirement as reading the answers there: a roster read outside
 * it would reopen #968's window one table over.
 */
export function makeSubmitHandler(deps: Deps): RouteHandler<typeof submitRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json") as Record<string, unknown>;
    const now = deps.clock.now();

    const session = await getSession(deps.databases.forRequest().exec, sessionId);
    if (session === undefined) throw fail.sessionNotFound();

    // Already submitted → idempotent: return the *existing* receipt unchanged
    // (one submission, one outbox row - nothing re-runs).
    if (session.status === "submitted") {
      const existing = await getSubmission(deps.databases.forRequest().exec, sessionId);
      if (existing === undefined) {
        throw new Error(`submit: session "${sessionId}" is submitted but has no submission row`);
      }
      return c.json(receiptFrom(existing), 200);
    }
    if (session.status === "expired" || session.expiresAt.getTime() <= now.getTime()) {
      throw fail.sessionExpired();
    }
    // `created` = no answer ever appended (the first append flips to
    // `in_progress`): there is nothing to submit.
    if (session.status === "created") throw fail.nothingToSubmit();

    // The pinned snapshot is immutable (I1/I4), so it is loaded outside the lock:
    // nothing a concurrent request can do changes it.
    const snapshot = await loadFrozenSnapshot(deps, session);

    // The min-time floor is per-form (`forms.min_submit_ms`) with the config
    // default as fallback (task 026). A missing form row here would be an
    // internal inconsistency (the session pins a formId), so fall back to the
    // default rather than fail the submission.
    const form = await getForm(deps.databases.forRequest().exec, session.formId);
    const minTimeFloorMs = form?.minSubmitMs ?? deps.config.antiAbuse.minSubmitMs;

    // Anti-abuse decision is pure over the request and the session row; it changes
    // whether the outbox event is enqueued, never the response shape. It reads no
    // answer, so it does not belong inside the lock.
    const flaggedReason = detectAbuse(deps, session, body, minTimeFloorMs);

    const receipt = await deps.databases.forRequest().exec.transaction(async (tx) => {
      // Serialize with concurrent submits/answers on this session (I5) so the
      // submitted-state check, the SWEEP and the writes are one atomic decision.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);

      // Re-check under the lock: a concurrent submit may have won the race.
      const current = await getSession(tx, sessionId);
      if (current !== undefined && current.status === "submitted") {
        const existing = await getSubmission(tx, sessionId);
        if (existing === undefined) {
          throw new Error(`submit: session "${sessionId}" is submitted but has no submission row`);
        }
        return receiptFrom(existing);
      }

      // Validate + lock through the kernel (the I9 sweep), INSIDE the lock (issue
      // #968). Hidden answers and removed instances are excluded from the locked set
      // here (I6, ADR-42); the ledger keeps them. The roster is derived from the same
      // locked read, so the answers, the roster and the hash are one consistent view.
      const answers: AnswerMap = await latestAnswers(tx, sessionId);
      const rosters = await loadRosters(tx, sessionId, snapshot.definition.steps, answers);
      const prepared = await prepareSubmission(snapshot, answers, rosters);
      if (!prepared.ok) {
        // Thrown from inside the transaction, which rolls it back. Nothing had been
        // written, so the rollback changes nothing a caller can see and the envelope
        // is the one it always was.
        throw new ApiError(
          "SUBMISSION_INVALID",
          422,
          "The submission has missing or invalid required answers",
          toSubmissionDetail(prepared.error),
        );
      }
      const locked = prepared.value;

      const inserted = await insertSubmission(tx, {
        sessionId,
        contentHash: locked.contentHash,
        lockedAnswers: locked,
        submittedAt: now,
        ...(flaggedReason !== undefined ? { flaggedReason } : {}),
      });
      await markSubmitted(tx, sessionId);

      // A flagged submission is withheld from webhooks (documented choice,
      // revisited in 035; released by the admin unflag, 023): its outbox event
      // is not enqueued. A clean submission emits `response.submitted` in this
      // same transaction - durable with the lock, never lost (§11).
      if (flaggedReason === undefined) {
        await enqueue(tx, {
          eventType: RESPONSE_SUBMITTED,
          payload: {
            sessionId,
            formId: session.formId,
            formVersion: session.formVersion,
            submittedAt: now.toISOString(),
            contentHash: locked.contentHash,
            // Locked (hidden-excluded, I6) answers - never the raw ledger.
            answers: locked.answers,
          },
        });
      }

      return receiptFrom(inserted);
    });

    return c.json(receipt, 200);
  };
}
