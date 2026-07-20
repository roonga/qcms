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
 * A **transaction script** (R5): load state (`@qcms/db`) → call the kernel
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
} from "@qcms/core";
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
} from "@qcms/db";
import { sql } from "drizzle-orm";
import type { Context } from "hono";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { FlagReason } from "../flag-reasons.js";
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
// hand-authored and sound across @qcms/db's package boundary (issue #5), so this
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
  const version = await getFormVersion(deps.db, session.formId, session.formVersion);
  if (version === undefined) {
    throw new Error(
      `submit: session "${session.sessionId}" is pinned to form ${session.formId}@${String(session.formVersion)} which does not exist`,
    );
  }
  const definition: FormDefinition = version.definition;

  const questions: QuestionVersionRecord[] = [];
  for (const step of definition.steps) {
    for (const ref of step.items) {
      const record = await getQuestionVersion(deps.db, ref.questionId, ref.version);
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
    // A published version always stamps the semantics it was validated under.
    semanticsVersion: Number(version.semanticsVersion),
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
 * load session (idempotent on `submitted`, reject `expired`/`created`) →
 * `prepareSubmission` (422 on a failed sweep) → one transaction (advisory lock,
 * insert lock, mark submitted, enqueue unless flagged).
 */
export function makeSubmitHandler(deps: Deps): RouteHandler<typeof submitRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json") as Record<string, unknown>;
    const now = deps.clock.now();

    const session = await getSession(deps.db, sessionId);
    if (session === undefined) throw fail.sessionNotFound();

    // Already submitted → idempotent: return the *existing* receipt unchanged
    // (one submission, one outbox row - nothing re-runs).
    if (session.status === "submitted") {
      const existing = await getSubmission(deps.db, sessionId);
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

    // Validate + lock through the kernel (the I9 sweep). Hidden answers are
    // excluded from the locked set here (I6); the ledger keeps them.
    const snapshot = await loadFrozenSnapshot(deps, session);
    const answers: AnswerMap = await latestAnswers(deps.db, sessionId);
    const prepared = await prepareSubmission(snapshot, answers);
    if (!prepared.ok) {
      throw new ApiError(
        "SUBMISSION_INVALID",
        422,
        "The submission has missing or invalid required answers",
        toSubmissionDetail(prepared.error),
      );
    }
    const locked = prepared.value;

    // The min-time floor is per-form (`forms.min_submit_ms`) with the config
    // default as fallback (task 026). A missing form row here would be an
    // internal inconsistency (the session pins a formId), so fall back to the
    // default rather than fail the submission.
    const form = await getForm(deps.db, session.formId);
    const minTimeFloorMs = form?.minSubmitMs ?? deps.config.antiAbuse.minSubmitMs;

    // Anti-abuse decision is pure over the (validated) submission; it changes
    // whether the outbox event is enqueued, never the response shape.
    const flaggedReason = detectAbuse(deps, session, body, minTimeFloorMs);

    const receipt = await deps.db.transaction(async (tx) => {
      // Serialize with concurrent submits/answers on this session (I5) so the
      // submitted-state check and the writes are one atomic decision.
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
