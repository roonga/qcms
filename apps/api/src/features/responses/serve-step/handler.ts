/**
 * The GET serves the audit copy stored at publish (ADR-18), never recompiling. Only
 * visible questions and their answers cross the projection (SEC); values are never logged
 * (SEC-8). Answer writes take a per-session advisory lock (I5).
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
  countBounds,
  type GroupId,
  type InstanceId,
  isRepeatGroup,
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
import type { RequestDatabase } from "../../../environments.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { spendAnswerAllowance } from "../rate-limits.js";
import {
  applyRosterOp,
  groupsOwedAMint,
  loadRosters,
  mintDueAndLoadRosters,
  type RosterRefusalCode,
} from "../roster.js";
import { parseSemanticsVersion, unsupportedSemanticsVersion } from "../semantics-version.js";
import { authenticateSession } from "../session-token.js";
// Type-only (erased at runtime, so no import cycle with route.ts).
import type { batchAnswersRoute, getStepRoute, rosterOpRoute, submitAnswerRoute } from "./route.js";
import type { BatchAnswerResponse, RosterOpResponse, StepResponse } from "./schema.js";

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
  unknownInstance: (): ApiError =>
    new ApiError("UNKNOWN_INSTANCE", 404, "No such instance in this session's roster"),
  crossSession: (): ApiError =>
    new ApiError("unauthorized", 401, "Session token does not match this session"),
} as const;

// Viewed structurally so apps/api does not depend on @roonga/qcms-a2ui-compiler; `root`
// is served verbatim and never interpreted (ADR-18).
interface CompiledDocumentView {
  readonly stepId: StepId;
  readonly root: unknown;
}
interface CompiledFormView {
  readonly documents: readonly CompiledDocumentView[];
}

/**
 * `frozen` carries the semantics stamp (ADR-16), putting serving behind the same
 * `UNSUPPORTED_SEMANTICS_VERSION` gate as submit. A missing row is an internal
 * inconsistency, so it throws.
 */
interface LoadedSnapshot {
  readonly frozen: FrozenSnapshot;
  readonly compiled: CompiledFormView;
  readonly a2uiSpecVersion: string;
  readonly resolveQuestion: ResolveQuestion;
  readonly questionById: ReadonlyMap<QuestionId, QuestionDefinition>;
}

async function loadSnapshot(
  request: RequestDatabase,
  session: SessionRow,
): Promise<LoadedSnapshot> {
  const version = await getFormVersion(request.exec, session.formId, session.formVersion);
  if (version === undefined) {
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
      const record = await getQuestionVersion(request.exec, ref.questionId, ref.version);
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
      // The stored stamp is text; a non-integer one is refused here rather than
      // reaching the evaluator as `NaN`.
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
 * An error here is an internal inconsistency. `UNSUPPORTED_SEMANTICS_VERSION` (ADR-16) gets
 * the typed envelope; every other code stays an opaque 500.
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

interface RenderedQuestions {
  readonly visibleQuestions: string[];
  readonly values: StepResponse["values"];
}

/**
 * Walking the visible set, never the ledger, is what keeps a stored answer from ever
 * disclosing a hidden question (SEC). An answer is absent when `latestAnswers` reports
 * none, so a retracted answer resumes as unanswered rather than as a stale value.
 */
function renderedQuestions(
  flow: FlowState,
  answers: AnswerMap,
  view: StepView,
  /**
   * The paginating group's live instances, per GROUP rather than per instance: a step may
   * hold a `perInstanceStep` group beside a `stacked` one, and the stacked group's every
   * instance belongs on every page of the paginated one.
   */
  paginated: ReadonlySet<InstanceId>,
): RenderedQuestions {
  const visibleQuestions: string[] = [];
  const values: Record<string, AnswerValue> = {};
  for (const entry of flow.visible) {
    if (entry.stepId !== view.stepId) continue;
    if (
      entry.instanceId !== undefined &&
      paginated.has(entry.instanceId) &&
      entry.instanceId !== view.instanceId
    ) {
      continue;
    }
    // A rule targeting inside a group is evaluated once per live instance, so a member
    // question can be visible in one instance and hidden in another and only the
    // qualified answer key can say which (ADR-42, ADR-43).
    const key = answerKey(entry.questionId, entry.instanceId);
    visibleQuestions.push(key);
    const held = answers.get(key);
    if (held !== undefined) values[key] = held;
  }
  return { visibleQuestions, values };
}

/**
 * `FlowState.missingRequired` lists a repeated question once, because its shape is frozen
 * under `SEMANTICS_VERSION`; the per-instance detail is in the parallel
 * `missingRequiredInstances`, present exactly when the form has a group.
 */
function missingRequiredKeys(flow: FlowState): string[] {
  const perInstance = flow.missingRequiredInstances;
  if (perInstance === undefined) return [...flow.missingRequired];
  return perInstance.map((entry) => answerKey(entry.questionId, entry.instanceId ?? undefined));
}

function rosterProjection(
  snapshot: LoadedSnapshot,
  rosters: RosterMap,
): { groupId: string; instances: string[] }[] {
  return repeatGroups(snapshot.frozen.definition.steps).map((group) => ({
    groupId: group.groupId,
    instances: [...(rosters.get(group.groupId) ?? [])],
  }));
}

interface StepView {
  readonly stepId: StepId;
  readonly instanceId: InstanceId | null;
}

function stepViewsOf(flow: FlowState): readonly StepView[] {
  const views = flow.visibleStepViews;
  if (views !== undefined) return views;
  return flow.visibleSteps.map((stepId) => ({ stepId, instanceId: null }));
}

/**
 * The cursor indexes views rather than steps (ADR-28), and it indexes a list the server
 * computed for this session on this request: that is what makes an out-of-range value
 * refusable by arithmetic and an in-range one a view the server had already made visible.
 */
function renderTarget(
  flow: FlowState,
  requestedIndex?: number,
  unopened?: UnopenedGroups,
): { readonly view: StepView | null; readonly stepIndex: number } {
  const views = stepViewsOf(flow);
  if (requestedIndex === undefined) return servedView(flow, views, unopened);
  if (views.length === 0) return { view: null, stepIndex: 0 };
  const clamped = Math.min(requestedIndex, views.length - 1);
  return { view: views[clamped] ?? null, stepIndex: clamped };
}

interface UnopenedGroups {
  readonly groupIds: ReadonlySet<GroupId>;
  readonly stepOf: ReadonlyMap<GroupId, StepId>;
}

function firstUnopenedView(
  views: readonly StepView[],
  unopened?: UnopenedGroups,
): { readonly view: StepView; readonly stepIndex: number } | null {
  if (unopened === undefined || unopened.groupIds.size === 0) return null;
  const steps = new Set<StepId>();
  for (const groupId of unopened.groupIds) {
    const stepId = unopened.stepOf.get(groupId);
    if (stepId !== undefined) steps.add(stepId);
  }
  const index = views.findIndex((view) => steps.has(view.stepId));
  const view = index < 0 ? undefined : views[index];
  return view === undefined ? null : { view, stepIndex: index };
}

/**
 * The view when no cursor was given: the first view whose instance is incomplete, so the
 * no-JS walk never revisits a finished page. If all are complete, the LAST view, which
 * carries the Add control.
 */
function servedView(
  flow: FlowState,
  views: readonly StepView[],
  unopened?: UnopenedGroups,
): { readonly view: StepView | null; readonly stepIndex: number } {
  // An unopened group's step is a candidate too: `currentStep` cannot nominate it (no visible
  // question until minted). Kept out of the kernel because `SEMANTICS_VERSION` is frozen.
  const owed = firstUnopenedView(views, unopened);
  const byFlow = currentStepView(flow, views);
  if (owed !== null && (byFlow.view === null || owed.stepIndex < byFlow.stepIndex)) return owed;
  return byFlow;
}

function currentStepView(
  flow: FlowState,
  views: readonly StepView[],
): { readonly view: StepView | null; readonly stepIndex: number } {
  const currentStep = flow.currentStep;
  if (currentStep === null) return { view: null, stepIndex: views.length };
  const onStep: number[] = [];
  views.forEach((view, index) => {
    if (view.stepId === currentStep) onStep.push(index);
  });
  const last = onStep[onStep.length - 1];
  if (last === undefined) return { view: null, stepIndex: views.length };
  // A view whose instance is named here still has work in it; `missingRequired` alone
  // cannot say which instance, which is why the parallel array exists.
  const incomplete = new Set(
    (flow.missingRequiredInstances ?? [])
      .map((entry) => entry.instanceId)
      .filter((instanceId): instanceId is InstanceId => instanceId !== null),
  );
  const chosen =
    onStep.find((index) => {
      const instanceId = views[index]?.instanceId ?? null;
      return instanceId !== null && incomplete.has(instanceId);
    }) ?? last;
  return { view: views[chosen] ?? null, stepIndex: chosen };
}

/**
 * Nothing about hidden questions or the rule graph crosses this boundary (SEC). The cursor
 * changes only the drawn document; `values` are display data beside it (ADR-18).
 */
function project(
  snapshot: LoadedSnapshot,
  flow: FlowState,
  answers: AnswerMap,
  rosters: RosterMap,
  requestedIndex?: number,
  unopened?: UnopenedGroups,
): StepResponse {
  const { view, stepIndex } = renderTarget(flow, requestedIndex, unopened);

  let step: StepResponse["step"] = null;
  let rendered: RenderedQuestions = { visibleQuestions: [], values: {} };
  // Both halves travel to the client in `view` below, so the renderer draws one instance
  // without deriving anything (R2).
  const group = view === null ? undefined : paginatingGroup(snapshot, view.stepId);
  const paginated = new Set<InstanceId>(
    group === undefined ? [] : (rosters.get(group.groupId) ?? []),
  );
  const drawnInstance = view?.instanceId ?? null;
  if (view !== null) {
    const document = snapshot.compiled.documents.find((doc) => doc.stepId === view.stepId);
    if (document === undefined) {
      // Every step has one compiled document; a gap is an internal break.
      throw new Error(`serve-step: no compiled document for visible step "${view.stepId}"`);
    }
    step = document;
    rendered = renderedQuestions(flow, answers, view, paginated);
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
    // Both keys are null for every page that is not a per-instance one.
    view: {
      groupId: drawnInstance === null ? null : (group?.groupId ?? null),
      instanceId: drawnInstance,
    },
    // Views, not steps: a three-instance group is three pages and the indicator says
    // three (ADR-28).
    progress: { stepIndex, totalVisibleSteps: stepViewsOf(flow).length },
  };
}

/**
 * Taking the FIRST such group follows the kernel's own choice in `stepViews`: the cursor
 * has to agree with the list it indexes.
 */
function paginatingGroup(snapshot: LoadedSnapshot, stepId: StepId): RepeatGroup | undefined {
  const step = snapshot.frozen.definition.steps.find((candidate) => candidate.stepId === stepId);
  if (step === undefined) return undefined;
  return step.items.find(
    (item): item is RepeatGroup => isRepeatGroup(item) && item.presentation === "perInstanceStep",
  );
}

/**
 * Two evaluations: the rendered step depends on the roster and the groups to mint depend on
 * the step. The mint is idempotent. The caller holds the transaction and advisory lock.
 */
async function projectWithRosters(
  exec: Parameters<typeof mintDueAndLoadRosters>[0],
  snapshot: LoadedSnapshot,
  sessionId: SessionId,
  answers: AnswerMap,
  requestedIndex?: number,
): Promise<StepResponse> {
  const steps = snapshot.frozen.definition.steps;
  // Pass one must be a READ: `now()` is the transaction timestamp, so two mints in one
  // transaction share `occurred_at` and fall to the `instance_id` tiebreaker.
  const first = evaluateOrThrow(
    snapshot,
    answers,
    await liveRosters(exec, sessionId, snapshot, answers),
  );
  // Read before the mint, because the mint is what makes the answer change.
  const unopened = {
    groupIds: await groupsOwedAMint(exec, { sessionId, steps, answers }),
    stepOf: groupStepIndex(steps),
  };
  const renderStep = renderTarget(first, requestedIndex, unopened).view?.stepId ?? null;
  const rosters = await mintDueAndLoadRosters(exec, { sessionId, steps, renderStep, answers });
  const flow = evaluateOrThrow(snapshot, answers, rosters);
  // The projection reuses `unopened` rather than recomputing it, which after the write
  // would say nothing is owed and send the response back to the step this passed over.
  return project(snapshot, flow, answers, rosters, requestedIndex, unopened);
}

/**
 * The live roster with nothing minted. Keeping it read-only is what makes "one mint pass
 * per transaction" a property of the code: a visibility check that minted would make its
 * own inputs depend on itself, under the same transaction timestamp.
 */
async function liveRosters(
  exec: Parameters<typeof mintDueAndLoadRosters>[0],
  sessionId: SessionId,
  snapshot: LoadedSnapshot,
  answers: AnswerMap,
): Promise<RosterMap> {
  return loadRosters(exec, sessionId, snapshot.frozen.definition.steps, answers);
}

function groupStepIndex(steps: readonly FormDefinition["steps"][number][]): Map<GroupId, StepId> {
  const stepOf = new Map<GroupId, StepId>();
  for (const step of steps) {
    for (const item of step.items) {
      if (isRepeatGroup(item)) stepOf.set(item.groupId, step.stepId);
    }
  }
  return stepOf;
}

function groupById(snapshot: LoadedSnapshot, groupId: string): RepeatGroup | undefined {
  return repeatGroups(snapshot.frozen.definition.steps).find(
    (group) => group.groupId === (groupId as GroupId),
  );
}

/** The token must bind the `id` in the path: a session id alone grants nothing (SEC-2). */
async function authorizedSessionId(c: Context<ApiEnv>, deps: Deps, id: string): Promise<SessionId> {
  const authedSessionId = await authenticateSession(c, deps);
  if (authedSessionId !== id) throw fail.crossSession();
  // The token already bound this id, so a parse failure is the same cross-session
  // rejection rather than a 500.
  const parsed = parseSessionId(id);
  if (!parsed.ok) throw fail.crossSession();
  return parsed.value;
}

async function loadActiveSession(
  request: RequestDatabase,
  id: SessionId,
  now: Date,
): Promise<SessionRow> {
  const session = await getSession(request.exec, id);
  if (session === undefined) throw fail.sessionNotFound();
  if (session.status === "submitted") throw fail.sessionSubmitted();
  if (session.status === "expired" || session.expiresAt.getTime() <= now.getTime()) {
    throw fail.sessionExpired();
  }
  return session;
}

export function makeGetStepHandler(deps: Deps): RouteHandler<typeof getStepRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const session = await loadActiveSession(request, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(request, session);

    // This read WRITES: a repeating group mints its instances the first time its step is
    // served (ADR-42). The mint is idempotent, and the lock is what stops two concurrent
    // serves each minting a full set.
    const projection = await request.exec.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      const answers = await latestAnswers(tx, sessionId);
      return projectWithRosters(tx, snapshot, sessionId, answers, requestedIndex);
    });

    return c.json(projection, 200);
  };
}

/**
 * A body `value` of literal `null` is a retraction (ADR-33), a separate branch from
 * validation. An empty value is refused with the usual 422 and never becomes a tombstone.
 * Visibility check, append and re-evaluation share one transaction under the lock (I6).
 */
export function makeSubmitAnswerHandler(
  deps: Deps,
): RouteHandler<typeof submitAnswerRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json");

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const session = await loadActiveSession(request, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(request, session);

    const target = answerTarget(snapshot, body);

    const projection = await request.exec.transaction(async (tx) => {
      // Serialize answer writes for this session (deterministic ledger order).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);

      // Evaluated against the latest answers AND the live roster under the lock, so the
      // visibility decision matches what will be appended (I6). A repeated question is
      // visible per instance, so the check is per cell.
      const before = await latestAnswers(tx, sessionId);
      const rosters = await liveRosters(tx, sessionId, snapshot, before);
      const beforeFlow = evaluateOrThrow(snapshot, before, rosters);
      if (!isCellVisible(beforeFlow, target)) throw fail.questionNotVisible();

      const applied = await applyOneAnswer(tx, sessionId, before, target);
      if (applied !== undefined) throw applied;

      const after = await latestAnswers(tx, sessionId);
      return projectWithRosters(tx, snapshot, sessionId, after, requestedIndex);
    });

    return c.json(projection, 200);
  };
}

/**
 * Resolved outside the transaction and before the lock, because it reads nothing but the
 * pinned snapshot. Whether the instance is LIVE is a roster question, answered under the
 * lock with visibility.
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
  // UNKNOWN_QUESTION as one simply not in the form.
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
 * Instance-blind would be wrong both ways: a question visible in one instance can be
 * hidden in another, and an answer naming an instance the roster no longer lists must be
 * refused rather than appended.
 */
function isCellVisible(flow: FlowState, target: AnswerTarget): boolean {
  return flow.visible.some(
    (entry) => entry.questionId === target.questionId && entry.instanceId === target.instanceId,
  );
}

/**
 * Returns the refusal rather than throwing it, because the batch endpoint has to record a
 * refusal per entry without abandoning the rest. The caller holds the lock and has
 * already checked visibility.
 */
async function applyOneAnswer(
  tx: Parameters<typeof latestAnswers>[0],
  sessionId: SessionId,
  before: AnswerMap,
  target: AnswerTarget,
): Promise<ApiError | undefined> {
  // A literal `null` is a RETRACTION clearing that one cell (ADR-33, ADR-42). The kernel
  // is never consulted, and this branch can never record a value, so it is not a way to
  // bypass validation for a real answer.
  if (target.value === null) {
    // Retracting a cell with no answer is a no-op: the portal posts a clear on any
    // commit of an empty control, so a tombstone over nothing is ledger noise.
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

  // The error names constraints and never echoes the value (SEC-8). `""` and `[]` are
  // refused here rather than converted into a retraction (ADR-33).
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
 * The most answers one step of this form can carry, from the PINNED snapshot. It is the
 * whole form's largest step, so naming another step cannot raise the ceiling.
 */
function stepAnswerBound(snapshot: LoadedSnapshot): number {
  const steps = snapshot.frozen.definition.steps;
  const bounds = steps.map((step) => {
    let total = 0;
    for (const item of step.items) {
      if (isRepeatGroup(item)) {
        const { max } = countBounds(item.count);
        total += item.items.length * (max ?? 1);
      } else {
        total += 1;
      }
    }
    return total;
  });
  return Math.max(1, ...bounds);
}

export function makeBatchAnswersHandler(
  deps: Deps,
): RouteHandler<typeof batchAnswersRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json");

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const session = await loadActiveSession(request, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(request, session);

    // Resolved before anything is spent or locked: an entry naming a question the form
    // does not pin is drift rather than a respondent's mistake, and refuses the whole
    // request as the single-answer route does.
    const targets = body.answers.map((entry) => answerTarget(snapshot, entry));

    // Per ENTRY, not per request, and before the lock, so a refused batch never takes it
    // and is never partially applied (SEC-16).
    await spendAnswerAllowance(deps, sessionId, targets.length, stepAnswerBound(snapshot));

    const result = await request.exec.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);
      const rejected: BatchAnswerResponse["rejected"] = [];
      // One flow evaluation for every visibility decision, against the state as the
      // batch found it, so a field's visibility cannot change under the batch it was
      // posted with.
      let answers = await latestAnswers(tx, sessionId);
      const rosters = await liveRosters(tx, sessionId, snapshot, answers);
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
        // name the same cell, and whether the ledger holds it is what decides whether a
        // clear appends at all.
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
 * A function rather than a ternary, because a ternary silently folds an unmapped code
 * onto whichever branch is last and would report it as `REPEAT_NOT_ADDABLE`.
 */
function rosterRefusal(code: RosterRefusalCode): ApiError {
  if (code === "REPEAT_MAX_REACHED") return fail.maxReached();
  if (code === "UNKNOWN_INSTANCE") return fail.unknownInstance();
  return fail.notAddable();
}

export function makeRosterOpHandler(deps: Deps): RouteHandler<typeof rosterOpRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
    const { step: requestedIndex } = c.req.valid("query");
    const sessionId = await authorizedSessionId(c, deps, id);
    const body = c.req.valid("json");

    const request = deps.databases.forRequest(c.get("requestEnvironment"));
    const session = await loadActiveSession(request, sessionId, deps.clock.now());
    const snapshot = await loadSnapshot(request, session);

    const group = groupById(snapshot, body.groupId);
    if (group === undefined) throw fail.unknownGroup();
    let instanceId: InstanceId | undefined;
    if (body.op === "remove") {
      if (body.instanceId === undefined) throw fail.instanceRequired();
      const parsed = parseInstanceId(body.instanceId);
      if (!parsed.ok) throw fail.instanceRequired();
      instanceId = parsed.value;
    }

    const result = await request.exec.transaction(async (tx) => {
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
      if (!outcome.ok) throw rosterRefusal(outcome.code);
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
