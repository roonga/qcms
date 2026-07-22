/**
 * Serving-loop handlers (task 019) - the respondent's read/answer loop.
 *
 * `GET /sessions/{id}/step` serves the current step's **stored** compiled A2UI
 * document plus a narrow flow projection; `POST /sessions/{id}/answers`
 * validates one answer through the kernel, appends it to the ledger, and
 * returns the re-evaluated projection.
 *
 * These are **transaction scripts** (R5): load state (`@qcms/db`) → call the
 * kernel (`evaluateRules` 006, `validateAnswer` 009) → persist. The GET **never
 * recompiles** - it serves the audit copy stored at publish (ADR-18); the only
 * flow authority is the kernel. Handlers are fetch-pure (R4): time via
 * `deps.clock`, no `node:*`.
 *
 * Two security properties hold by construction:
 *
 * - **No leak of the hidden flow.** The client projection carries only the
 *   *visible* questions of the current step and the *visible* missing-required
 *   set - never the full rule graph or the inventory of hidden questions (SEC).
 * - **Answer values are never logged** (SEC-8): errors and the append path name
 *   `questionId`s and counts, never content.
 *
 * Answer writes for one session are **serialized** by a Postgres transaction
 * advisory lock keyed on the session id (`pg_advisory_xact_lock`), so the
 * append-only ledger's order is deterministic even under concurrent submits (I5).
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  type AnswerMap,
  type AnswerValue,
  evaluateRules,
  type FlowState,
  type FormDefinition,
  parseQuestionId,
  parseSessionId,
  type QuestionDefinition,
  type QuestionId,
  type ResolveQuestion,
  type SessionId,
  type StepId,
  validateAnswer,
} from "@qcms/core";
import {
  appendAnswer,
  getFormVersion,
  getQuestionVersion,
  getSession,
  latestAnswers,
  markInProgress,
  type SessionRow,
} from "@qcms/db";
import { sql } from "drizzle-orm";
import type { Context } from "hono";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { authenticateSession } from "../session-token.js";
// Type-only (erased at runtime, so no import cycle with route.ts).
import type { getStepRoute, submitAnswerRoute } from "./route.js";
import type { StepResponse } from "./schema.js";

// --- typed failures (envelope codes the portal keys off, 029) ---------------

const fail = {
  sessionNotFound: (): ApiError => new ApiError("SESSION_NOT_FOUND", 404, "No such session"),
  sessionSubmitted: (): ApiError =>
    new ApiError("SESSION_SUBMITTED", 409, "This session has already been submitted"),
  sessionExpired: (): ApiError => new ApiError("SESSION_EXPIRED", 409, "This session has expired"),
  unknownQuestion: (): ApiError =>
    new ApiError("UNKNOWN_QUESTION", 404, "No such question in this form"),
  questionNotVisible: (): ApiError =>
    new ApiError("QUESTION_NOT_VISIBLE", 409, "This question is not currently visible"),
  crossSession: (): ApiError =>
    new ApiError("unauthorized", 401, "Session token does not match this session"),
} as const;

// The enum-bearing `sessions` and `question_versions` rows are hand-authored and
// sound across @qcms/db's package boundary (issue #5), so this slice consumes
// `SessionRow` and the inferred `question_versions` row directly - no local view
// or cast for the row types.

// The stored compiled A2UI, viewed structurally so apps/api keeps 018's boundary
// (it does not depend on @qcms/a2ui-compiler): one document per step, `root` the
// opaque A2UI node tree the API serves verbatim and never interprets (ADR-18).
interface CompiledDocumentView {
  readonly stepId: StepId;
  readonly root: unknown;
}
interface CompiledFormView {
  readonly documents: readonly CompiledDocumentView[];
}

/**
 * The pinned snapshot for a session: the frozen domain definition, the stored
 * compiled A2UI, the served spec version, and a pure `resolveQuestion` lookup
 * over the pinned question versions (the `required` flags the kernel needs).
 *
 * Loaded once per request from the `form_versions` row the session is pinned to
 * (I4) plus each pinned `question_versions` row. A missing row here is an
 * internal inconsistency in a *published* snapshot (I2), not a client error, so
 * it throws (opaque 500) rather than returning a typed envelope.
 */
interface LoadedSnapshot {
  readonly definition: FormDefinition;
  readonly compiled: CompiledFormView;
  readonly a2uiSpecVersion: string;
  readonly resolveQuestion: ResolveQuestion;
  readonly questionById: ReadonlyMap<QuestionId, QuestionDefinition>;
}

async function loadSnapshot(deps: Deps, session: SessionRow): Promise<LoadedSnapshot> {
  const version = await getFormVersion(deps.db, session.formId, session.formVersion);
  if (version === undefined) {
    // A session is pinned at creation to a published version that is immutable
    // (I1/I4); its absence is an internal invariant break, never client input.
    throw new Error(
      `serve-step: session "${session.sessionId}" is pinned to form ${session.formId}@${String(session.formVersion)} which does not exist`,
    );
  }
  const definition: FormDefinition = version.definition;
  const compiled = version.compiled as unknown as CompiledFormView;

  const questionById = new Map<QuestionId, QuestionDefinition>();
  for (const step of definition.steps) {
    for (const ref of step.items) {
      const record = await getQuestionVersion(deps.db, ref.questionId, ref.version);
      if (record === undefined) {
        throw new Error(
          `serve-step: pinned question ${ref.questionId}@${String(ref.version)} is missing for form ${session.formId}@${String(session.formVersion)} (snapshot not self-contained)`,
        );
      }
      questionById.set(ref.questionId, record.definition);
    }
  }

  return {
    definition,
    compiled,
    a2uiSpecVersion: version.a2uiSpecVersion,
    resolveQuestion: (questionId) => questionById.get(questionId),
    questionById,
  };
}

/**
 * Evaluate the flow for the given answers, throwing on the totality-error
 * codes: a *published* snapshot with resolved question versions never errs
 * (I2/I7), so an error here is an internal inconsistency, not client input.
 */
function evaluateOrThrow(snapshot: LoadedSnapshot, answers: AnswerMap): FlowState {
  const result = evaluateRules(snapshot.definition, answers, snapshot.resolveQuestion);
  if (!result.ok) {
    throw new Error(
      `serve-step: evaluateRules failed on a published snapshot (${result.error.code})`,
    );
  }
  return result.value;
}

/**
 * Project the kernel's `FlowState` to the client-safe response (SEC): the
 * RENDERED step's stored compiled document, the visible questions of that step,
 * the visible missing-required set, and progress. Nothing about hidden questions
 * or the rule graph crosses this boundary.
 *
 * `requestedIndex` is the explicit navigation cursor (ADR-28): the 0-based index
 * of the visible step the portal wants drawn. When present, the handler renders
 * exactly that visible step (clamped to the visible range) even when the flow as
 * a whole is complete, so a step never collapses or advances as a side effect of
 * answering (findings M/N). When absent (resume, no-JS, the 019/029 callers), the
 * first incomplete step is served - the original behaviour, unchanged.
 *
 * The cursor changes ONLY which document is drawn and the `visibleQuestions` /
 * `progress.stepIndex` that go with it. `flowState.currentStep`,
 * `missingRequired`, and `readyToSubmit` are always the authoritative,
 * cursor-independent flow projection - the portal reads them to gate
 * Continue/Submit and never re-derives them (R2).
 */
function project(snapshot: LoadedSnapshot, flow: FlowState, requestedIndex?: number): StepResponse {
  const visibleSteps = flow.visibleSteps;

  let renderStep: StepId | null;
  let stepIndex: number;
  if (requestedIndex !== undefined) {
    if (visibleSteps.length === 0) {
      // A degenerate flow with no visible steps: nothing to render.
      renderStep = null;
      stepIndex = 0;
    } else {
      const clamped = Math.min(requestedIndex, visibleSteps.length - 1);
      renderStep = visibleSteps[clamped] ?? null;
      stepIndex = clamped;
    }
  } else {
    renderStep = flow.currentStep;
    stepIndex =
      flow.currentStep !== null ? visibleSteps.indexOf(flow.currentStep) : visibleSteps.length;
  }

  let step: StepResponse["step"] = null;
  let visibleQuestions: string[] = [];
  if (renderStep !== null) {
    const document = snapshot.compiled.documents.find((doc) => doc.stepId === renderStep);
    if (document === undefined) {
      // Every step has one compiled document (011); a gap is an internal break.
      throw new Error(`serve-step: no compiled document for visible step "${renderStep}"`);
    }
    step = document;
    visibleQuestions = flow.visible
      .filter((entry) => entry.stepId === renderStep)
      .map((entry) => entry.questionId);
  }

  return {
    step,
    a2uiSpecVersion: snapshot.a2uiSpecVersion,
    flowState: {
      currentStep: flow.currentStep,
      visibleQuestions,
      missingRequired: flow.missingRequired,
      readyToSubmit: flow.complete,
    },
    progress: { stepIndex, totalVisibleSteps: visibleSteps.length },
  };
}

/** Authenticate and confirm the token binds the `id` in the path (SEC-2 §3). */
async function authorizedSessionId(c: Context<ApiEnv>, deps: Deps, id: string): Promise<SessionId> {
  const authedSessionId = await authenticateSession(c, deps);
  if (authedSessionId !== id) throw fail.crossSession();
  // The token already bound this exact id, so parsing it cannot fail in
  // practice; treat a failure as the same cross-session rejection, not a 500.
  const parsed = parseSessionId(id);
  if (!parsed.ok) throw fail.crossSession();
  return parsed.value;
}

/** Load a session for a request, rejecting a missing / submitted / expired one. */
async function loadActiveSession(deps: Deps, id: SessionId, now: Date): Promise<SessionRow> {
  const session = await getSession(deps.db, id);
  if (session === undefined) throw fail.sessionNotFound();
  if (session.status === "submitted") throw fail.sessionSubmitted();
  if (session.status === "expired" || session.expiresAt.getTime() <= now.getTime()) {
    throw fail.sessionExpired();
  }
  return session;
}

/**
 * `GET /sessions/{id}/step`. Session-token authed. Serves the stored compiled
 * document for the current step and the flow projection - never a recompilation
 * (ADR-18).
 */
export function makeGetStepHandler(deps: Deps): RouteHandler<typeof getStepRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);

    const session = await loadActiveSession(deps, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(deps, session);
    const answers = await latestAnswers(deps.db, sessionId);
    const flow = evaluateOrThrow(snapshot, answers);

    return c.json(project(snapshot, flow, requestedIndex), 200);
  };
}

/**
 * `POST /sessions/{id}/answers`. Session-token authed. Validates one answer
 * against its pinned question version, appends it to the ledger, and returns the
 * re-evaluated projection. Ordering (task 019): session active → question
 * exists (`UNKNOWN_QUESTION`) → currently visible (`QUESTION_NOT_VISIBLE`) →
 * value valid (422) → append.
 *
 * The visibility check, append, mark, and re-evaluation run inside one
 * transaction holding a per-session advisory lock, so concurrent submits are
 * serialized and the ledger's order is deterministic (I6: only legitimately
 * givable answers are recorded).
 */
export function makeSubmitAnswerHandler(
  deps: Deps,
): RouteHandler<typeof submitAnswerRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json");

    const session = await loadActiveSession(deps, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(deps, session);

    // Question must exist in the pinned snapshot (else UNKNOWN_QUESTION). A
    // malformed id can never name a pinned question, so it lands here too.
    const parsed = parseQuestionId(body.questionId);
    if (!parsed.ok) throw fail.unknownQuestion();
    const questionId = parsed.value;
    const definition = snapshot.questionById.get(questionId);
    if (definition === undefined) throw fail.unknownQuestion();

    const projection = await deps.db.transaction(async (tx) => {
      // Serialize answer writes for this session (deterministic ledger order).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);

      // Currently visible? Evaluate against the latest answers under the lock,
      // so the visibility decision matches what will be appended (I6).
      const before = await latestAnswers(tx, sessionId);
      const beforeFlow = evaluateOrThrow(snapshot, before);
      const isVisible = beforeFlow.visible.some((entry) => entry.questionId === questionId);
      if (!isVisible) throw fail.questionNotVisible();

      // Validate the value against the pinned question version (009). On failure
      // return the kernel's full error list; the message names constraints, the
      // value is never echoed (SEC-8).
      const validated = validateAnswer(definition, body.value);
      if (!validated.ok) {
        throw new ApiError("INVALID_ANSWER", 422, "The answer failed validation", {
          questionId,
          errors: validated.error,
        });
      }
      const value: AnswerValue = validated.value;

      await appendAnswer(tx, { sessionId, questionId, value });
      await markInProgress(tx, sessionId);

      const after = await latestAnswers(tx, sessionId);
      return project(snapshot, evaluateOrThrow(snapshot, after), requestedIndex);
    });

    return c.json(projection, 200);
  };
}
