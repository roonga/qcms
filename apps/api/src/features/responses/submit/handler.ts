/**
 * The lock, the status flip and the outbox event share one transaction, so a durable
 * submission can never miss its event and an event never names a submission that is not.
 *
 * Answer values are never logged (SEC-8); hidden answers stay in the ledger and never
 * cross into the locked set or the webhook payload (I6); a flagged submit returns the
 * same success-shaped receipt as a clean one, so the tell never leaks.
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
import type { RequestDatabase } from "../../../environments.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { FlagReason } from "../flag-reasons.js";
import { loadRosters } from "../roster.js";
import { parseSemanticsVersion } from "../semantics-version.js";
import { authenticateSession } from "../session-token.js";
// Type-only (erased at runtime, so no import cycle with route.ts).
import type { submitRoute } from "./route.js";
import type { SubmitResponse } from "./schema.js";

const RESPONSE_SUBMITTED = "response.submitted" as const;

const fail = {
  sessionNotFound: (): ApiError => new ApiError("SESSION_NOT_FOUND", 404, "No such session"),
  sessionExpired: (): ApiError => new ApiError("SESSION_EXPIRED", 409, "This session has expired"),
  nothingToSubmit: (): ApiError =>
    new ApiError("NOTHING_TO_SUBMIT", 409, "This session has no answers to submit"),
  crossSession: (): ApiError =>
    new ApiError("unauthorized", 401, "Session token does not match this session"),
} as const;

/**
 * Rebuilt from the pinned rows, so the sweep re-validates against the exact frozen
 * definitions. A missing row is an internal inconsistency, not client input, so it throws.
 */
async function loadFrozenSnapshot(
  request: RequestDatabase,
  session: SessionRow,
): Promise<FrozenSnapshot> {
  const version = await getFormVersion(request.exec, session.formId, session.formVersion);
  if (version === undefined) {
    throw new Error(
      `submit: session "${session.sessionId}" is pinned to form ${session.formId}@${String(session.formVersion)} which does not exist`,
    );
  }
  const definition: FormDefinition = version.definition;

  const questions: QuestionVersionRecord[] = [];
  for (const step of definition.steps) {
    for (const ref of stepQuestionRefs(step)) {
      const record = await getQuestionVersion(request.exec, ref.questionId, ref.version);
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
    semanticsVersion: parseSemanticsVersion(version.semanticsVersion),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };
}

/** The token must bind the `id` in the path: a session id alone grants nothing (SEC-2). */
async function authorizedSessionId(c: Context<ApiEnv>, deps: Deps, id: string): Promise<SessionId> {
  const authedSessionId = await authenticateSession(c, deps);
  if (authedSessionId !== id) throw fail.crossSession();
  const parsed = parseSessionId(id);
  if (!parsed.ok) throw fail.crossSession();
  return parsed.value;
}

/** The same shape whether the row was flagged or clean, so the tell never leaks. */
function receiptFrom(row: { submittedAt: Date; contentHash: string }): SubmitResponse {
  return { submittedAt: row.submittedAt.toISOString(), contentHash: row.contentHash };
}

/** A reason flags the row and withholds its webhook event; `minTimeFloorMs` 0 disables that check. */
function detectAbuse(
  deps: Deps,
  session: SessionRow,
  body: Record<string, unknown>,
  minTimeFloorMs: number,
): FlagReason | undefined {
  const { honeypotField } = deps.config.antiAbuse;

  // A non-string value counts as filled by its mere presence: a legitimate client
  // leaves the decoy empty or absent.
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

/** The 422 detail carries question ids only, never answer content (SEC-8). */
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
 * The ledger read, the roster derivation and the sweep all run inside the advisory lock:
 * a retraction committing between a read outside it and the seal would leave the ledger
 * and the content hash describing different answer sets.
 */
export function makeSubmitHandler(deps: Deps): RouteHandler<typeof submitRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json") as Record<string, unknown>;
    const now = deps.clock.now();

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const session = await getSession(request.exec, sessionId);
    if (session === undefined) throw fail.sessionNotFound();

    // Idempotent: the existing receipt, so one submission means one outbox row.
    if (session.status === "submitted") {
      const existing = await getSubmission(request.exec, sessionId);
      if (existing === undefined) {
        throw new Error(`submit: session "${sessionId}" is submitted but has no submission row`);
      }
      return c.json(receiptFrom(existing), 200);
    }
    if (session.status === "expired" || session.expiresAt.getTime() <= now.getTime()) {
      throw fail.sessionExpired();
    }
    // `created` means no answer was ever appended, so there is nothing to submit.
    if (session.status === "created") throw fail.nothingToSubmit();

    // The pinned snapshot is immutable, so no concurrent request can change it.
    const snapshot = await loadFrozenSnapshot(request, session);

    const form = await getForm(request.exec, session.formId);
    const minTimeFloorMs = form?.minSubmitMs ?? deps.config.antiAbuse.minSubmitMs;

    // Reads no answer, so it has no need of the lock below.
    const flaggedReason = detectAbuse(deps, session, body, minTimeFloorMs);

    const receipt = await request.exec.transaction(async (tx) => {
      // Serializes with concurrent submits and answer writes on this session, so the
      // status check, the sweep and the writes are one atomic decision (I5).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);

      // Re-checked under the lock: a concurrent submit may have won the race.
      const current = await getSession(tx, sessionId);
      if (current !== undefined && current.status === "submitted") {
        const existing = await getSubmission(tx, sessionId);
        if (existing === undefined) {
          throw new Error(`submit: session "${sessionId}" is submitted but has no submission row`);
        }
        return receiptFrom(existing);
      }

      // Hidden answers and removed instances are excluded from the locked set, and the
      // ledger keeps them (I6). All three reads are one consistent view.
      const answers: AnswerMap = await latestAnswers(tx, sessionId);
      const rosters = await loadRosters(tx, sessionId, snapshot.definition.steps, answers);
      const prepared = await prepareSubmission(snapshot, answers, rosters);
      if (!prepared.ok) {
        // Rolls the transaction back, which had written nothing.
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

      // A flagged submission is withheld from webhooks until an admin releases it.
      if (flaggedReason === undefined) {
        await enqueue(tx, {
          eventType: RESPONSE_SUBMITTED,
          payload: {
            sessionId,
            formId: session.formId,
            formVersion: session.formVersion,
            submittedAt: now.toISOString(),
            contentHash: locked.contentHash,
            // The locked answers exclude hidden questions (I6); never the raw ledger.
            answers: locked.answers,
          },
        });
      }

      return receiptFrom(inserted);
    });

    return c.json(receipt, 200);
  };
}
