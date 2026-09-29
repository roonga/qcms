/**
 * Serving-loop handlers (task 019) - the respondent's read/answer loop.
 *
 * `GET /sessions/{id}/step` serves the current step's **stored** compiled A2UI
 * document, the answers already held for that step, and a narrow flow projection;
 * `POST /sessions/{id}/answers` validates one answer through the kernel, appends
 * it to the ledger, and returns the re-evaluated projection.
 *
 * These are **transaction scripts** (R5): load state (`@roonga/qcms-db`) → call the
 * kernel (`evaluateRules` 006, `validateAnswer` 009) → persist. The GET **never
 * recompiles** - it serves the audit copy stored at publish (ADR-18); the only
 * flow authority is the kernel. Handlers are fetch-pure (R4): time via
 * `deps.clock`, no `node:*`.
 *
 * Two security properties hold by construction:
 *
 * - **No leak of the hidden flow.** The client projection carries only the
 *   *visible* questions of the current step, the *visible* missing-required set,
 *   and the answers held for those same visible questions - never the full rule
 *   graph, never the inventory of hidden questions, and never a hidden question's
 *   stored answer (SEC).
 * - **Answer values are never logged** (SEC-8): errors and the append path name
 *   `questionId`s and counts, never content.
 *
 * Answer writes for one session are **serialized** by a Postgres transaction
 * advisory lock keyed on the session id (`pg_advisory_xact_lock`), so the
 * append-only ledger's order is deterministic even under concurrent submits (I5).
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  type AnswerKey,
  type AnswerMap,
  answerKey,
  type AnswerValue,
  evaluateRules,
  type FlowState,
  type FormDefinition,
  type FrozenSnapshot,
  type GroupId,
  type InstanceId,
  parseInstanceId,
  parseQuestionId,
  parseSessionId,
  type QuestionDefinition,
  type QuestionId,
  type QuestionVersionRecord,
  type RepeatGroup,
  type ResolveQuestion,
  repeatGroups,
  type RosterMap,
  type SessionId,
  SNAPSHOT_SCHEMA_VERSION,
  type StepId,
  validateAnswer,
  stepQuestionRefs,
} from "@roonga/qcms-core";
import {
  appendAnswer,
  getFormVersion,
  getQuestionVersion,
  getSession,
  latestAnswers,
  markInProgress,
  readRoster,
  retractAnswer,
  type SessionRow,
} from "@roonga/qcms-db";
import { sql } from "drizzle-orm";
import type { Context } from "hono";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { spendAnswerAllowance } from "../rate-limits.js";
import { applyRosterOp, mintDueAndLoadRosters } from "../roster.js";
import { parseSemanticsVersion, unsupportedSemanticsVersion } from "../semantics-version.js";
import { authenticateSession } from "../session-token.js";
// Type-only (erased at runtime, so no import cycle with route.ts).
import type { batchAnswersRoute, getStepRoute, rosterOpRoute, submitAnswerRoute } from "./route.js";
import type { BatchAnswerResponse, RosterOpResponse, StepResponse } from "./schema.js";

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
  unknownGroup: (): ApiError =>
    new ApiError("UNKNOWN_GROUP", 404, "No such repeating group in this form"),
  notAddable: (): ApiError =>
    new ApiError("REPEAT_NOT_ADDABLE", 409, "This group's size is not the respondent's to change"),
  maxReached: (): ApiError =>
    new ApiError("REPEAT_MAX_REACHED", 409, "This group is already at the size its author allows"),
  instanceRequired: (): ApiError =>
    new ApiError("INVALID_INSTANCE_ID", 400, "A removal names the instance to remove"),
  crossSession: (): ApiError =>
    new ApiError("unauthorized", 401, "Session token does not match this session"),
} as const;

// The enum-bearing `sessions` and `question_versions` rows are hand-authored and
// sound across @roonga/qcms-db's package boundary (issue #5), so this slice consumes
// `SessionRow` and the inferred `question_versions` row directly - no local view
// or cast for the row types.

// The stored compiled A2UI, viewed structurally so apps/api keeps 018's boundary
// (it does not depend on @roonga/qcms-a2ui-compiler): one document per step, `root` the
// opaque A2UI node tree the API serves verbatim and never interprets (ADR-18).
interface CompiledDocumentView {
  readonly stepId: StepId;
  readonly root: unknown;
}
interface CompiledFormView {
  readonly documents: readonly CompiledDocumentView[];
}

/**
 * The pinned snapshot for a session: the kernel's `FrozenSnapshot` (definition,
 * pinned question versions, and the semantics stamp the row records), the
 * stored compiled A2UI, the served spec version, and a pure `resolveQuestion`
 * lookup over the pinned question versions (the `required` flags the kernel
 * needs).
 *
 * `frozen` carries the stamp on purpose (ADR-16, issue #723): handing
 * `evaluateRules` the whole snapshot rather than a bare `FormDefinition` is what
 * puts the serving loop behind the same `UNSUPPORTED_SEMANTICS_VERSION` gate the
 * submit path has, so a snapshot recorded under superseded semantics is refused
 * at the first read instead of being branched by the current evaluator and
 * failing only at submit.
 *
 * Loaded once per request from the `form_versions` row the session is pinned to
 * (I4) plus each pinned `question_versions` row. A missing row here is an
 * internal inconsistency in a *published* snapshot (I2), not a client error, so
 * it throws (opaque 500) rather than returning a typed envelope.
 */
interface LoadedSnapshot {
  readonly frozen: FrozenSnapshot;
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
  const questions: QuestionVersionRecord[] = [];
  for (const step of definition.steps) {
    for (const ref of stepQuestionRefs(step)) {
      const record = await getQuestionVersion(deps.db, ref.questionId, ref.version);
      if (record === undefined) {
        throw new Error(
          `serve-step: pinned question ${ref.questionId}@${String(ref.version)} is missing for form ${session.formId}@${String(session.formVersion)} (snapshot not self-contained)`,
        );
      }
      questionById.set(ref.questionId, record.definition);
      questions.push({
        questionId: ref.questionId,
        version: ref.version,
        definition: record.definition,
      });
    }
  }

  return {
    frozen: {
      definition,
      questions,
      // The stored stamp is text; a stamp that is not a decimal integer is
      // refused here rather than reaching the evaluator as `NaN` (issue #723).
      semanticsVersion: parseSemanticsVersion(version.semanticsVersion),
      // Unused by the flow evaluation; stamped for shape completeness.
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    },
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
 *
 * `UNSUPPORTED_SEMANTICS_VERSION` is the one exception, and it is a *reachable*
 * state rather than a bug (ADR-16): a snapshot published under semantics this
 * build no longer implements is exactly what the stamp exists to catch. It gets
 * the typed envelope so the refusal names its cause, while every other code
 * stays an opaque 500.
 */
function evaluateOrThrow(
  snapshot: LoadedSnapshot,
  answers: AnswerMap,
  rosters?: RosterMap,
): FlowState {
  const result = evaluateRules(snapshot.frozen, answers, snapshot.resolveQuestion, rosters);
  if (!result.ok) {
    if (result.error.code === "UNSUPPORTED_SEMANTICS_VERSION") throw unsupportedSemanticsVersion();
    throw new Error(
      `serve-step: evaluateRules failed on a published snapshot (${result.error.code})`,
    );
  }
  return result.value;
}

/**
 * One rendered step's client-safe contents: which questions, and what is held.
 *
 * `values` borrows `StepResponse`'s own type rather than restating it, so the
 * canonical-`AnswerValue` contract the schema publishes (issue #153) is the type
 * the compiler holds this builder to.
 */
interface RenderedQuestions {
  readonly visibleQuestions: string[];
  readonly values: StepResponse["values"];
}

/**
 * The visible questions of the rendered step, paired with the answers the server
 * already holds for exactly those questions (issue #146).
 *
 * Walking the visible set (never the ledger) is what keeps the two aligned: a
 * question the flow hides contributes neither an id nor an answer, so a stored
 * answer can never disclose a hidden question (SEC). An answer is absent when
 * `latestAnswers` reports none, which includes a question whose newest ledger row
 * is an ADR-33 retraction - so a cleared answer resumes as unanswered rather than
 * resurfacing as a stale value.
 */
function renderedQuestions(
  flow: FlowState,
  answers: AnswerMap,
  renderStep: StepId,
): RenderedQuestions {
  const visibleQuestions: string[] = [];
  const values: Record<string, AnswerValue> = {};
  for (const entry of flow.visible) {
    if (entry.stepId !== renderStep) continue;
    // The ANSWER KEY, not the bare question id: a bare `questionId` outside every
    // repeating group, byte-identical to what this always sent, and
    // `instanceId/questionId` inside one (ADR-42, ADR-43). A rule targeting inside a
    // group is evaluated once per live instance, so a member question can be visible
    // in one instance and hidden in another, and only the qualified key can say
    // which. Below this boundary that key is the field's WHOLE identity - the
    // renderer's expansion, the `FieldBlur` wrapper's id, the `__qk__` markers, the
    // BFF decoder and the error summary's anchors all key on one opaque string.
    const key = answerKey(entry.questionId, entry.instanceId);
    visibleQuestions.push(key);
    const held = answers.get(key);
    if (held !== undefined) values[key] = held;
  }
  return { visibleQuestions, values };
}

/**
 * The missing-required set as answer keys.
 *
 * `FlowState.missingRequired` lists a **repeated** question once, because its shape is
 * frozen under `SEMANTICS_VERSION` and widening it would fail every committed golden
 * scenario (ADR-16's amendment, Q8). The per-instance detail is in the parallel
 * `missingRequiredInstances`, which is present exactly when the form has a group, so
 * this reads that when it is there and the original when it is not. A form with no
 * group therefore produces the identical array it always did.
 */
function missingRequiredKeys(flow: FlowState): string[] {
  const perInstance = flow.missingRequiredInstances;
  if (perInstance === undefined) return [...flow.missingRequired];
  return perInstance.map((entry) => answerKey(entry.questionId, entry.instanceId ?? undefined));
}

/** The roster projection: the live instances per group, document order of the groups. */
function rosterProjection(
  snapshot: LoadedSnapshot,
  rosters: RosterMap,
): { groupId: string; instances: string[] }[] {
  return repeatGroups(snapshot.frozen.definition.steps).map((group) => ({
    groupId: group.groupId,
    instances: [...(rosters.get(group.groupId) ?? [])],
  }));
}

/**
 * Which visible step this response draws, and its 0-based index: the explicit
 * ADR-28 cursor when one is given (clamped to the visible range), otherwise the
 * flow's own first-incomplete step. `null` means nothing is drawn.
 */
function renderTarget(
  flow: FlowState,
  requestedIndex?: number,
): { readonly stepId: StepId | null; readonly stepIndex: number } {
  const visibleSteps = flow.visibleSteps;
  if (requestedIndex === undefined) {
    return {
      stepId: flow.currentStep,
      stepIndex:
        flow.currentStep !== null ? visibleSteps.indexOf(flow.currentStep) : visibleSteps.length,
    };
  }
  // A degenerate flow with no visible steps: nothing to render.
  if (visibleSteps.length === 0) return { stepId: null, stepIndex: 0 };
  const clamped = Math.min(requestedIndex, visibleSteps.length - 1);
  return { stepId: visibleSteps[clamped] ?? null, stepIndex: clamped };
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
 *
 * `values` carries the answers already held for the rendered step's visible
 * questions (issue #146), so a resumed session can DISPLAY what the server holds
 * instead of painting empty controls over it. They travel beside the compiled
 * document, never inside it (ADR-18), and they are display data only - no
 * decision moves client-side with them (R2). Answers to questions the flow hides
 * are excluded, so the hidden-flow property is unchanged (SEC).
 */
function project(
  snapshot: LoadedSnapshot,
  flow: FlowState,
  answers: AnswerMap,
  rosters: RosterMap,
  requestedIndex?: number,
): StepResponse {
  const { stepId: renderStep, stepIndex } = renderTarget(flow, requestedIndex);

  let step: StepResponse["step"] = null;
  let rendered: RenderedQuestions = { visibleQuestions: [], values: {} };
  if (renderStep !== null) {
    const document = snapshot.compiled.documents.find((doc) => doc.stepId === renderStep);
    if (document === undefined) {
      // Every step has one compiled document (011); a gap is an internal break.
      throw new Error(`serve-step: no compiled document for visible step "${renderStep}"`);
    }
    step = document;
    rendered = renderedQuestions(flow, answers, renderStep);
  }

  return {
    step,
    values: rendered.values,
    a2uiSpecVersion: snapshot.a2uiSpecVersion,
    flowState: {
      currentStep: flow.currentStep,
      visibleQuestions: rendered.visibleQuestions,
      missingRequired: missingRequiredKeys(flow),
      readyToSubmit: flow.complete,
    },
    rosters: rosterProjection(snapshot, rosters),
    progress: { stepIndex, totalVisibleSteps: flow.visibleSteps.length },
  };
}

/**
 * Evaluate the flow with the live roster, minting whatever this request has made due,
 * and project it. The one call every serving path below makes.
 *
 * **Two evaluations, and the second is not waste.** Which step is rendered depends on
 * the flow, which depends on the roster; which groups are due to mint depends on which
 * step is rendered. So the flow is evaluated once against the roster as it stands, the
 * render target is read off it, the groups on that step (plus every `fromAnswer` group,
 * whose target follows a count answer written earlier) are minted, and the flow is
 * evaluated again against the roster that results. The second pass is skipped by
 * nothing and costs nothing measurable: the mint is idempotent, so a form with no
 * group mints nothing and the second evaluation is over the identical inputs.
 *
 * The caller owns the transaction and holds the session's advisory lock, because this
 * writes: two concurrent serves of one step would otherwise each see an empty roster
 * and each mint a full set.
 */
async function projectWithRosters(
  exec: Parameters<typeof mintDueAndLoadRosters>[0],
  snapshot: LoadedSnapshot,
  sessionId: SessionId,
  answers: AnswerMap,
  requestedIndex?: number,
): Promise<StepResponse> {
  const steps = snapshot.frozen.definition.steps;
  const first = evaluateOrThrow(
    snapshot,
    answers,
    await loadLiveRosters(exec, sessionId, snapshot, answers),
  );
  const { stepId: renderStep } = renderTarget(first, requestedIndex);
  const rosters = await mintDueAndLoadRosters(exec, { sessionId, steps, renderStep, answers });
  const flow = evaluateOrThrow(snapshot, answers, rosters);
  return project(snapshot, flow, answers, rosters, requestedIndex);
}

/**
 * The first of the two passes above: the live roster before the render target is
 * known. It still mints every `fromAnswer` group, whose target follows a count answer
 * and does not depend on which step is drawn, and no step-scoped group at all.
 */
async function loadLiveRosters(
  exec: Parameters<typeof mintDueAndLoadRosters>[0],
  sessionId: SessionId,
  snapshot: LoadedSnapshot,
  answers: AnswerMap,
): Promise<RosterMap> {
  return mintDueAndLoadRosters(exec, {
    sessionId,
    steps: snapshot.frozen.definition.steps,
    renderStep: null,
    answers,
  });
}

/** The repeating group this id names in the pinned snapshot, or `undefined`. */
function groupById(snapshot: LoadedSnapshot, groupId: string): RepeatGroup | undefined {
  return repeatGroups(snapshot.frozen.definition.steps).find(
    (group) => group.groupId === (groupId as GroupId),
  );
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

    // This read WRITES, and that is a consequence of the repeating group rather than
    // a change of character: a `fixed` group mints its `count` and an `open` group
    // mints `min` (or one) the first time its step is served, so the respondent sees a
    // card to fill rather than an empty group with a button (ADR-42). The mint is
    // idempotent against the rows it already wrote, so serving the same step twice
    // mints nothing the second time; the transaction and the advisory lock are what
    // stop two concurrent serves each minting a full set. A form with no repeating
    // group writes nothing at all and this transaction is one lock and two reads.
    const projection = await deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      const answers = await latestAnswers(tx, sessionId);
      return projectWithRosters(tx, snapshot, sessionId, answers, requestedIndex);
    });

    return c.json(projection, 200);
  };
}

/**
 * `POST /sessions/{id}/answers`. Session-token authed. Validates one answer
 * against its pinned question version, appends it to the ledger, and returns the
 * re-evaluated projection. Ordering (task 019): session active → question
 * exists (`UNKNOWN_QUESTION`) → currently visible (`QUESTION_NOT_VISIBLE`) →
 * value valid (422) → append.
 *
 * A body `value` of literal `null` is a **retraction** (ADR-33, issue #95): the
 * same route, the same gates, but the ledger gets a tombstone append instead of
 * an answer and the question resolves to unanswered. It is a separate branch
 * taken before validation, never a validation outcome, so no real answer can
 * reach the ledger through it.
 *
 * `null` is the only clear. An **empty** value (`""` or `[]`) is not a second
 * spelling of it: the kernel refuses it (`EMPTY_ANSWER_NOT_ALLOWED`) and this
 * handler returns the same 422 it returns for any other invalid value, before
 * the append - so an empty post stores nothing and is never silently converted
 * into a tombstone (ADR-33 closed in issue #128's batch). A whitespace-only text
 * value is a legal answer and IS appended; it just confers no presence, so the
 * re-evaluated projection still reports the question in `missingRequired`.
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

    const target = answerTarget(snapshot, body);

    const projection = await deps.db.transaction(async (tx) => {
      // Serialize answer writes for this session (deterministic ledger order).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);

      // Currently visible? Evaluate against the latest answers AND the live roster
      // under the lock, so the visibility decision matches what will be appended
      // (I6). A repeated question is visible per instance, so the check is per cell.
      const before = await latestAnswers(tx, sessionId);
      const rosters = await loadLiveRosters(tx, sessionId, snapshot, before);
      const beforeFlow = evaluateOrThrow(snapshot, before, rosters);
      if (!isCellVisible(beforeFlow, target)) throw fail.questionNotVisible();

      // A literal `null` body value is a RETRACTION, not an answer (ADR-33): the
      // respondent cleared a question they had answered. It appends a tombstone
      // that `latestAnswers` resolves to unanswered, so the flow re-evaluates
      // with the question missing (and a required one blocks Continue again).
      // The kernel is never consulted, because a retraction is not an
      // `AnswerValue` and has nothing to validate; equally, this branch can never
      // record a value, so it is not a way to bypass validation for a real
      // answer. It runs behind the same authorization, session, visibility and
      // rate-limit gates as an answer write.
      const applied = await applyOneAnswer(tx, sessionId, before, target);
      if (applied !== undefined) throw applied;

      const after = await latestAnswers(tx, sessionId);
      return projectWithRosters(tx, snapshot, sessionId, after, requestedIndex);
    });

    return c.json(projection, 200);
  };
}

/**
 * One answer's target: the question, its pinned definition, the instance it belongs to
 * and the answer key those two make.
 *
 * Resolved OUTSIDE the transaction and before the lock, because it reads nothing but
 * the pinned snapshot: a body naming a question the form does not pin, or an instance
 * id that is not one, is refused before any state is touched. Whether the instance is
 * LIVE is a roster question and is answered under the lock, with visibility.
 */
interface AnswerTarget {
  readonly questionId: QuestionId;
  readonly instanceId: InstanceId | undefined;
  readonly key: AnswerKey;
  readonly definition: QuestionDefinition;
  readonly value: unknown;
}

function answerTarget(
  snapshot: LoadedSnapshot,
  body: { questionId: string; instanceId?: string | undefined; value: unknown },
): AnswerTarget {
  // A malformed id can never name a pinned question, so it lands on the same
  // UNKNOWN_QUESTION as one that simply is not in the form.
  const parsed = parseQuestionId(body.questionId);
  if (!parsed.ok) throw fail.unknownQuestion();
  const questionId = parsed.value;
  const definition = snapshot.questionById.get(questionId);
  if (definition === undefined) throw fail.unknownQuestion();
  let instanceId: InstanceId | undefined;
  if (body.instanceId !== undefined) {
    const instance = parseInstanceId(body.instanceId);
    if (!instance.ok) {
      throw new ApiError("INVALID_INSTANCE_ID", 400, "That is not an instance id");
    }
    instanceId = instance.value;
  }
  return {
    questionId,
    instanceId,
    key: answerKey(questionId, instanceId),
    definition,
    value: body.value,
  };
}

/**
 * Whether this exact cell is visible: the question AND the instance.
 *
 * Instance-blind would be wrong in both directions. A rule targeting inside a group is
 * evaluated once per live instance, so a question visible in passenger 1 can be hidden
 * in passenger 2; and an answer naming an instance the roster no longer lists must be
 * refused rather than appended, or a removed instance could be answered.
 */
function isCellVisible(flow: FlowState, target: AnswerTarget): boolean {
  return flow.visible.some(
    (entry) => entry.questionId === target.questionId && entry.instanceId === target.instanceId,
  );
}

/**
 * Apply one answer to the ledger, or return the `ApiError` that refuses it.
 *
 * Returns rather than throws, because the batch endpoint below applies several and has
 * to record a refusal per entry without abandoning the rest. The single-answer handler
 * throws what it is handed, so its envelope is unchanged.
 *
 * The caller holds the lock and has already checked visibility.
 */
async function applyOneAnswer(
  tx: Parameters<typeof latestAnswers>[0],
  sessionId: SessionId,
  before: AnswerMap,
  target: AnswerTarget,
): Promise<ApiError | undefined> {
  // A literal `null` body value is a RETRACTION, not an answer (ADR-33), and it
  // names an instance too: it clears THAT CELL alone (ADR-33's Note, ADR-42). The
  // kernel is never consulted, because a retraction is not an `AnswerValue` and has
  // nothing to validate; equally this branch can never record a value, so it is not a
  // way to bypass validation for a real answer.
  if (target.value === null) {
    // Retracting a cell that currently has no answer is a no-op: the portal posts a
    // clear on any commit of an empty control, and a tombstone over nothing records
    // no event while adding ledger noise on every blur.
    if (before.has(target.key)) {
      await retractAnswer(tx, {
        sessionId,
        questionId: target.questionId,
        ...(target.instanceId !== undefined ? { instanceId: target.instanceId } : {}),
      });
      await markInProgress(tx, sessionId);
    }
    return undefined;
  }

  // Validate the value against the pinned question version (009). On failure the
  // kernel's full error list travels; the message names constraints and the value is
  // never echoed (SEC-8). `""` and `[]` are refused here, never converted into a
  // retraction, so an empty post stores nothing (ADR-33, issue #128).
  const validated = validateAnswer(target.definition, target.value);
  if (!validated.ok) {
    return new ApiError("INVALID_ANSWER", 422, "The answer failed validation", {
      questionId: target.questionId,
      ...(target.instanceId !== undefined ? { instanceId: target.instanceId } : {}),
      errors: validated.error,
    });
  }
  const value: AnswerValue = validated.value;
  await appendAnswer(tx, {
    sessionId,
    questionId: target.questionId,
    value,
    ...(target.instanceId !== undefined ? { instanceId: target.instanceId } : {}),
  });
  await markInProgress(tx, sessionId);
  return undefined;
}

/**
 * `POST /sessions/{id}/answers/batch`. Session-token authed. One Continue's answers,
 * in one request, under one session lock, with one flow evaluation (Q20, ADR-43).
 *
 * **Why it exists.** The no-JS path posts a whole step, and the portal made one
 * `POST /sessions/{id}/answers` per decoded answer, sequentially, each taking the
 * session's advisory lock and re-evaluating the whole flow. Nine passengers times six
 * questions is fifty-four round trips and fifty-four advisory locks for one Continue.
 *
 * **It carries a Continue's answers only.** The roster operation is its own post and
 * commits no answers, so the earlier claim that the batch makes the two one
 * transaction does not hold and is withdrawn (ADR-43).
 *
 * **Refusals are per entry, and that mirrors what the portal already did one call at a
 * time.** A 422 on one cell fills that cell's error slot and the remaining answers are
 * still applied, because a respondent who mistyped one field of nine passengers must
 * not lose the other fifty-three. `QUESTION_NOT_VISIBLE` is recorded the same way and
 * is not an error the respondent sees: a whole-step post carries fields rendered before
 * this round's answers changed a branch. What IS all-or-nothing is the **rate limit**:
 * a batch that cannot be paid for in full is refused before any entry is applied.
 *
 * **The rate limit is spent per ENTRY** from the same per-session answer bucket the
 * single-answer route spends from (SEC-16). It is spent before the transaction opens,
 * so a refused batch never takes the lock.
 */
export function makeBatchAnswersHandler(
  deps: Deps,
): RouteHandler<typeof batchAnswersRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json");

    const session = await loadActiveSession(deps, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(deps, session);

    // Resolve every entry against the pinned snapshot before anything is spent or
    // locked: an entry naming a question the form does not pin, or an id that is not
    // an instance id, is drift rather than a respondent's mistake and refuses the
    // whole request as the single-answer route does.
    const targets = body.answers.map((entry) => answerTarget(snapshot, entry));

    // Per ENTRY, not per request, and before the lock (SEC-16).
    await spendAnswerAllowance(deps, sessionId, targets.length);

    const result = await deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      const rejected: BatchAnswerResponse["rejected"] = [];
      // One flow evaluation for the visibility decisions, against the state as the
      // batch found it. That is the same reading the portal's fifty-four sequential
      // calls could not agree on: each of those re-evaluated between writes, so a
      // field's visibility could change under the batch it was posted with.
      let answers = await latestAnswers(tx, sessionId);
      const rosters = await loadLiveRosters(tx, sessionId, snapshot, answers);
      const flow = evaluateOrThrow(snapshot, answers, rosters);
      for (const target of targets) {
        if (!isCellVisible(flow, target)) {
          rejected.push({
            questionId: target.questionId,
            ...(target.instanceId !== undefined ? { instanceId: target.instanceId } : {}),
            code: "QUESTION_NOT_VISIBLE",
          });
          continue;
        }
        const refusal = await applyOneAnswer(tx, sessionId, answers, target);
        if (refusal !== undefined) {
          rejected.push({
            questionId: target.questionId,
            ...(target.instanceId !== undefined ? { instanceId: target.instanceId } : {}),
            code: refusal.code,
            ...(refusal.details !== undefined ? { details: refusal.details } : {}),
          });
          continue;
        }
        // Re-read so a later entry's retraction sees this one's write: two entries can
        // name the same cell (a respondent who cleared and refilled it), and "does the
        // ledger hold this cell" is what decides whether a clear appends at all.
        answers = await latestAnswers(tx, sessionId);
      }
      const projection = await projectWithRosters(
        tx,
        snapshot,
        sessionId,
        await latestAnswers(tx, sessionId),
        requestedIndex,
      );
      return { ...projection, rejected };
    });

    return c.json(result, 200);
  };
}

/**
 * `POST /sessions/{id}/roster`. Session-token authed. The respondent's Add or Remove
 * (ADR-43).
 *
 * **It applies the roster operation and commits NO answers**, and that is the ruling
 * of 2026-09-30 rather than an implementation choice. The typed values ride the step
 * POST, are carried back for the re-render, and reach the ledger only on Continue under
 * the ordinary validation an ordinary Continue does. That is what makes
 * `formnovalidate` on the Add and Remove buttons safe rather than merely convenient,
 * and it is why `docs/portal-constraints.md`'s "a required question cannot be CLEARED
 * without scripting" bullet is unchanged: an emptied required field on an Add post is
 * not a retraction, because no answer write happens at all.
 *
 * **The one-time operation token makes a replay a no-op.** The rendered page minted it
 * into the button's value; `applyRosterOp` records it with the row it writes and
 * returns `replayed: true` for a token already spent, so a reload of the 200 re-render
 * or a Back that resubmits re-renders the same instances. A **refused** Add records
 * nothing, so a refusal cannot be replayed into an acceptance either.
 *
 * It has its own rate limit beside the answer write (SEC-16), and it rides the same
 * origin belt, because the roster operation IS a step POST (SEC-9).
 */
export function makeRosterOpHandler(deps: Deps): RouteHandler<typeof rosterOpRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json");

    const session = await loadActiveSession(deps, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(deps, session);

    const group = groupById(snapshot, body.groupId);
    if (group === undefined) throw fail.unknownGroup();
    let instanceId: InstanceId | undefined;
    if (body.op === "remove") {
      if (body.instanceId === undefined) throw fail.instanceRequired();
      const parsed = parseInstanceId(body.instanceId);
      if (!parsed.ok) throw fail.instanceRequired();
      instanceId = parsed.value;
    }

    const result = await deps.db.transaction(async (tx) => {
      // The lock is what makes "has this token been spent" and "write the row" one
      // decision, which is why the token needs no database constraint.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      const answers = await latestAnswers(tx, sessionId);
      const roster = await readRoster(tx, sessionId, group.groupId);
      const outcome = await applyRosterOp(tx, {
        sessionId,
        group,
        roster,
        answers,
        opToken: body.opToken,
        ...(body.op === "remove"
          ? { op: "remove" as const, instanceId: instanceId! }
          : { op: "add" as const }),
      });
      if (!outcome.ok) {
        throw outcome.code === "REPEAT_MAX_REACHED" ? fail.maxReached() : fail.notAddable();
      }
      const projection = await projectWithRosters(tx, snapshot, sessionId, answers, requestedIndex);
      return {
        ...projection,
        replayed: outcome.replayed,
        minted: [...outcome.minted],
      } satisfies RosterOpResponse;
    });

    return c.json(result, 200);
  };
}
