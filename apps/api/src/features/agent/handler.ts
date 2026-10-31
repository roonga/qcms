import type { RouteHandler } from "@hono/zod-openapi";

import {
  getDraft,
  getLatestPublishedVersion,
  listQuestionVersions,
  listQuestions,
} from "@roonga/qcms-db";
import { getForm, getWorkspace } from "@roonga/qcms-db";
import type { QuestionRow, QuestionVersionRow } from "@roonga/qcms-db";
import { parseFormId, type FormDefinition, type FormId, type QuestionId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import {
  checkQuestionDefinition,
  createQuestionWithFirstDraft,
  requireUnusedQuestionId,
  type DefinitionRefusal,
} from "../questions/create.js";
import {
  projectDraftFlow,
  requireFormDefinition,
  storeDraftDefinition,
  validateDraft,
} from "../forms/handler.js";
import type { Resource } from "../membership/policy.js";
import { PRODUCTION_ENVIRONMENT } from "../membership/policy.js";
import { holdsInstallationClaim, resolveGrants } from "../membership/resolver.js";
import { offeredActionKinds, offersNoAction } from "./grant-filter.js";
import { buildProposal } from "./tools/propose.js";
import type { AgentToolName } from "./tools/registry.js";
import {
  requireCell,
  requireForm,
  requireQuestion,
  type ScreenBuildInput,
  type ScreenParams,
} from "./contexts/support.js";
import { isFormSubtreeScreen, isScreenId, SCREENS, type ScreenId } from "./screens.js";
import type { acceptProposalRoute, assistRoute, screenAssistRoute } from "./route.js";
import type {
  AgentContext,
  AssistContext,
  AssistEvent,
  AssistTurn,
  LibraryEntry,
  ProjectDraftPort,
} from "./types.js";

const fail = {
  noDraft: (): ApiError => new ApiError("NOT_FOUND", 404, "This form has no draft to work on yet"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  invalidId: (): ApiError => new ApiError("INVALID_ID", 400, "Malformed form id"),
  staleDraft: (): ApiError =>
    new ApiError(
      "DRAFT_STALE",
      409,
      "The draft changed since this conversation started; reload the builder and try again",
    ),
  unknownScreen: (): ApiError =>
    new ApiError(
      "UNKNOWN_SCREEN",
      400,
      "That screen is not in this deployment's screen registry, so there is no context to build.",
    ),
  screenOutsideForm: (): ApiError =>
    new ApiError(
      "SCREEN_NOT_IN_FORM",
      400,
      "This route is one form's own, so its turns name a screen of that form's subtree.",
    ),
  noWorkspaceForTool: (): ApiError =>
    new ApiError(
      "FORBIDDEN",
      403,
      "This screen has no workspace of its own, so no tool that needs a grant runs on it.",
    ),
  /** Names which question, since a proposal card can list several. */
  proposedQuestionRefused: (questionId: string, issues: readonly DefinitionRefusal[]): ApiError =>
    new ApiError(
      "INVALID_QUESTION_DEFINITION",
      422,
      `Proposed question "${questionId}" was refused: ${issues[0]?.message ?? "the definition is invalid"} Nothing was saved.`,
      { questionId, issues },
    ),
};

/** Published only: a question still in draft is not pinnable. */
function questionLibrary(deps: Deps) {
  return {
    async search(query: string | undefined, limit: number): Promise<readonly LibraryEntry[]> {
      const needle = query?.trim().toLowerCase();
      const summaries = await listQuestions(deps.databases.control);
      const candidates = summaries.filter(
        (q) =>
          needle === undefined ||
          needle === "" ||
          q.slug.toLowerCase().includes(needle) ||
          q.questionId.toLowerCase().includes(needle),
      );

      const entries: LibraryEntry[] = [];
      for (const candidate of candidates) {
        if (entries.length >= limit) break;
        const entry = await latestPublished(deps, candidate.questionId, candidate.slug);
        if (entry !== undefined) entries.push(entry);
      }
      return entries;
    },
  };
}

/** Picks the maximum rather than trusting the query helper's ordering, which is not its contract. */
async function latestPublished(
  deps: Deps,
  questionId: QuestionId,
  slug: string,
): Promise<LibraryEntry | undefined> {
  const versions = await listQuestionVersions(deps.databases.control, questionId);
  let newest: (typeof versions)[number] | undefined;
  for (const version of versions) {
    if (version.status !== "published") continue;
    if (newest === undefined || version.version > newest.version) newest = version;
  }
  if (newest === undefined) return undefined;
  return { questionId, slug, version: newest.version, definition: newest.definition };
}

function draftToken(updatedAt: Date): string {
  return updatedAt.toISOString();
}

function maxStepsFor(deps: Deps): number {
  return deps.config.agent.provider === "none" ? 1 : deps.config.agent.maxSteps;
}

/** The builder screen's draft ports, which are {@link AssistContext}'s shape. */
function buildContext(
  deps: Deps,
  draft: FormDefinition,
  conversation: readonly AssistTurn[],
): AssistContext {
  return {
    draft,
    questionLibrary: questionLibrary(deps),
    conversation,
    // The builder's own validation, so the two verdicts cannot disagree.
    validate: async (definition) => {
      const { issues, warnings } = await validateDraft(deps, definition);
      return { issues, warnings };
    },
    maxSteps: maxStepsFor(deps),
  };
}

/**
 * The turn's context: the screen's facts, built under the caller's grants, and the ports
 * its declared tools close over. The facts are parsed rather than trusted, so a field a
 * builder added without declaring it fails here instead of reaching the provider.
 */
async function buildScreenContext(args: {
  readonly deps: Deps;
  readonly screen: ScreenId;
  readonly build: ScreenBuildInput;
  readonly conversation: readonly AssistTurn[];
  /** Resolved after the screen's own cell check, so no draft is read before it. */
  readonly drafts?: () => Promise<AssistContext | undefined>;
}): Promise<AgentContext> {
  const screen = SCREENS[args.screen];
  const facts = screen.facts.parse(await screen.build(args.build));
  const drafts = await args.drafts?.();
  const workspaceId = await screenWorkspace(args.build);
  const actions = await actionPorts({
    deps: args.deps,
    build: args.build,
    screen: args.screen,
    workspaceId,
  });
  return {
    screen: args.screen,
    facts,
    conversation: args.conversation,
    maxSteps: maxStepsFor(args.deps),
    tools: [...screen.readTools, ...actions.tools],
    // The same evaluator the route middleware uses, closed over this caller and the
    // workspace this screen's subject belongs to.
    authorize: async (cell) => {
      if (workspaceId === undefined) throw fail.noWorkspaceForTool();
      await requireCell(args.build, {
        workspaceId,
        resource: cell.resource as Resource,
        action: cell.action,
      });
    },
    ...(drafts === undefined
      ? {}
      : {
          draft: drafts.draft,
          questionLibrary: drafts.questionLibrary,
          validate: drafts.validate,
        }),
    ...(screen.readTools.includes("project_draft") && drafts !== undefined
      ? { projectDraft: projectionPort(args.deps, drafts.draft) }
      : {}),
    ...actions.ports,
  };
}

/**
 * The propose tools' port and the kinds the grant filter offered this caller on this
 * screen. A screen with no action kind, or a caller holding none of them, gets neither the
 * port nor the tools, which is how "a read-only user is offered no write" is structural
 * rather than a prompt (principle point 1, SEC-17).
 */
async function actionPorts(args: {
  readonly deps: Deps;
  readonly build: ScreenBuildInput;
  readonly screen: ScreenId;
  readonly workspaceId: string | undefined;
}): Promise<{
  readonly tools: readonly AgentToolName[];
  readonly ports: Partial<Pick<AgentContext, "propose" | "offeredActionKinds">>;
}> {
  const kinds = SCREENS[args.screen].actionKinds;
  if (kinds.length === 0 || args.workspaceId === undefined) return { tools: [], ports: {} };

  const resolved = await resolveGrants(args.deps.databases.control, {
    userId: args.build.principal.userId,
    workspaceId: args.workspaceId,
    claim: args.build.principal.claim,
  });
  const offered = offeredActionKinds({
    memberRole: resolved.memberRole,
    grants: resolved.grants,
    environments: args.deps.databases.names,
    current: args.build.environment,
    kinds,
    formId: args.build.params.formId,
  });
  // Present with an empty list rather than absent, so the system prompt can say this user
  // changes nothing here.
  if (offersNoAction(offered)) return { tools: [], ports: { offeredActionKinds: offered } };

  const workspace = await getWorkspace(args.deps.databases.control, args.workspaceId);
  return {
    tools: ["propose_action", "propose_plan"],
    ports: {
      offeredActionKinds: offered,
      propose: (steps, proposalsThisTurn) =>
        buildProposal({
          steps,
          subject: args.build.principal.userId,
          appKey: args.deps.config.keys.app,
          current: args.build.environment,
          offered,
          requireSecondApprover: workspace?.requireSecondApprover ?? false,
          productionEnvironment: PRODUCTION_ENVIRONMENT,
          formId: args.build.params.formId,
          issuedAt: args.deps.clock.now(),
          proposalsThisTurn,
        }),
    },
  };
}

/** The workspace a tool's cell is judged against: the screen's own subject. */
async function screenWorkspace(input: ScreenBuildInput): Promise<string | undefined> {
  if (input.params.formId !== undefined) return (await requireForm(input)).workspaceId;
  if (input.params.questionId !== undefined) return (await requireQuestion(input)).workspaceId;
  return input.params.workspaceId;
}

function projectionPort(deps: Deps, draft: FormDefinition): ProjectDraftPort {
  return async (answers) => projectDraftFlow(deps, draft, answers);
}

function screenBuildInput(args: {
  readonly deps: Deps;
  readonly principal: { readonly userId: string; readonly claim: boolean };
  readonly environment: string;
  readonly params: ScreenParams;
  readonly conversationId: string | undefined;
}): ScreenBuildInput {
  return {
    deps: args.deps,
    principal: args.principal,
    environment: args.environment,
    params: args.params,
    // A turn with no conversation id is deduplicated against nothing, so an audited read
    // writes its row every time rather than sharing a forged key.
    conversationId: args.conversationId ?? `turn:${crypto.randomUUID()}`,
  };
}

const encoder = new TextEncoder();

function frame(event: AssistEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** Silence before a keep-alive comment, so an ingress idle timeout does not cut a long turn. */
export const ASSIST_HEARTBEAT_MS = 15_000;

const HEARTBEAT = ": keep-alive\n\n";

/** Relay events as an SSE body with a keep-alive comment per silent stretch; timing is injectable for tests. */
export function assistSseStream(args: {
  readonly events: AsyncIterable<AssistEvent>;
  readonly heartbeatMs: number;
  readonly onError: (error: unknown) => void;
  readonly onCancel: () => void;
}): ReadableStream<Uint8Array> {
  const { events, heartbeatMs, onError, onCancel } = args;
  return new ReadableStream<Uint8Array>({
    async start(stream) {
      let open = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = (): void => {
        timer = setTimeout(() => {
          if (!open) return;
          stream.enqueue(encoder.encode(HEARTBEAT));
          arm();
        }, heartbeatMs);
      };

      arm();
      try {
        for await (const event of events) {
          clearTimeout(timer);
          stream.enqueue(frame(event));
          arm();
        }
      } catch (error) {
        onError(error);
        stream.enqueue(
          frame({
            type: "error",
            code: "PROVIDER_ERROR",
            message: "The assistant stopped unexpectedly.",
          }),
        );
      } finally {
        open = false;
        clearTimeout(timer);
        stream.close();
      }
    },
    cancel() {
      onCancel();
    },
  });
}

function assistStream(
  deps: Deps,
  ctx: AgentContext,
  controller: AbortController,
): ReadableStream<Uint8Array> {
  return assistSseStream({
    events: deps.draftAssistant.assist(ctx, controller.signal),
    heartbeatMs: ASSIST_HEARTBEAT_MS,
    onError: (error) => {
      deps.logger.error("draft assist stream failed", {
        reason: error instanceof Error ? error.name : "unknown",
      });
    },
    onCancel: () => {
      controller.abort();
    },
  });
}

export function makeAssistHandler(deps: Deps): RouteHandler<typeof assistRoute, ApiEnv> {
  return async (c) => {
    const parsedId = parseFormId(c.req.valid("param").id);
    if (!parsedId.ok) throw fail.invalidId();
    const formId: FormId = parsedId.value;

    const body = c.req.valid("json");

    // Falls back to the latest published version, as the builder's own read does;
    // without it a freshly published form would 404 while the builder shows a draft.
    const draftRow = await getDraft(deps.databases.control, formId);
    let definition: FormDefinition;
    if (draftRow === undefined) {
      const published = await getLatestPublishedVersion(deps.databases.control, formId);
      if (published === undefined) throw fail.noDraft();
      definition = published.definition;
    } else {
      definition = draftRow.definition;
      if (body.clientState !== undefined && body.clientState !== draftToken(draftRow.updatedAt)) {
        throw fail.staleDraft();
      }
    }

    // This route is the builder's own, so a turn that names no screen is a turn on the
    // builder, and a named screen has to be one of this form's subtree.
    const screen = requireScreen(body.screen ?? "/forms/[formId]");
    if (!isFormSubtreeScreen(screen)) throw fail.screenOutsideForm();

    const controller = new AbortController();
    // The request's own signal is the client's disconnect: relay it upstream.
    c.req.raw.signal.addEventListener("abort", () => {
      controller.abort();
    });

    const ctx = await buildScreenContext({
      deps,
      screen,
      conversation: body.conversation,
      drafts: () => Promise.resolve(buildContext(deps, definition, body.conversation)),
      build: screenBuildInput({
        deps,
        principal: callerOf(c),
        environment: deps.databases.forRequest(c.get("requestEnvironment")).environment,
        // The form the route names wins over anything a body says, so a turn cannot ask
        // about another form.
        params: { ...(body.params ?? {}), formId },
        conversationId: body.conversationId,
      }),
    });

    return new Response(assistStream(deps, ctx, controller), {
      status: 200,
      headers: sseHeaders(),
    });
  };
}

function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    // Proxies that buffer would defeat the point of streaming progress.
    "x-accel-buffering": "no",
  };
}

function requireScreen(raw: string): ScreenId {
  if (!isScreenId(raw)) throw fail.unknownScreen();
  return raw;
}

function callerOf(c: {
  get(key: "adminPrincipal"): { readonly userId: string; readonly role: string } | undefined;
}): { readonly userId: string; readonly claim: boolean } {
  const principal = c.get("adminPrincipal");
  if (principal === undefined) {
    throw new ApiError("unauthorized", 401, "Admin authentication required");
  }
  return { userId: principal.userId, claim: holdsInstallationClaim(principal.role) };
}

/**
 * The turn for a screen with no form in its route. One screen id, one context builder,
 * one door: the registry decides what this turn may read, and the builder checks its own
 * SEC-3 cell before it reads it.
 */
export function makeScreenAssistHandler(
  deps: Deps,
): RouteHandler<typeof screenAssistRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const screen = requireScreen(body.screen);

    const controller = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => {
      controller.abort();
    });

    const build = screenBuildInput({
      deps,
      principal: callerOf(c),
      environment: deps.databases.forRequest(c.get("requestEnvironment")).environment,
      params: body.params ?? {},
      conversationId: body.conversationId,
    });
    const ctx = await buildScreenContext({
      deps,
      screen,
      conversation: body.conversation,
      build,
      ...(isFormSubtreeScreen(screen) ? { drafts: () => formSubtreeDrafts(deps, build) } : {}),
    });

    return new Response(assistStream(deps, ctx, controller), {
      status: 200,
      headers: sseHeaders(),
    });
  };
}

/**
 * A form-subtree screen reached through this route still gets the draft ports its own
 * route would give it, so one screen behaves the same whichever route carried the turn.
 */
async function formSubtreeDrafts(
  deps: Deps,
  build: ScreenBuildInput,
): Promise<AssistContext | undefined> {
  const { formId } = await requireForm(build);
  const draftRow = await getDraft(deps.databases.control, formId);
  const definition =
    draftRow?.definition ??
    (await getLatestPublishedVersion(deps.databases.control, formId))?.definition;
  if (definition === undefined) return undefined;
  return buildContext(deps, definition, []);
}

/** Derived so the operator can predict it; a collision is a clean 409, not a mangled name. */
function slugFor(questionId: string): string {
  return questionId.replace(/^q_/, "").replace(/_/g, "-");
}

/** Read positionally: the value failed to parse, so there is no kernel-blessed id to quote. */
function proposedIdOf(value: unknown): string {
  const id = (value as { questionId?: unknown } | null)?.questionId;
  return typeof id === "string" && id !== "" ? id : "(unnamed)";
}

type CreatedQuestion = { question: QuestionRow; version: QuestionVersionRow };

function codeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : "UNKNOWN";
}

/**
 * Every refusal takes this path, so one event name counts them together and tells them
 * apart by `reason`. Ids and codes only, never the definition itself (SEC-8).
 */
function logRefusal(
  deps: Deps,
  formId: FormId,
  questionId: string,
  reason: string,
  issues: readonly DefinitionRefusal[],
): void {
  deps.logger.warn("agent proposal refused", {
    formId,
    questionId,
    reason,
    issues: issues.map((issue) => issue.code),
  });
}

/**
 * One transaction over the questions and the draft, so a draft never pins a question
 * whose creation failed and no compensating delete is needed. Kernel and
 * authoring-boundary validation run first, so a refusal costs no database work.
 */
export function makeAcceptProposalHandler(
  deps: Deps,
): RouteHandler<typeof acceptProposalRoute, ApiEnv> {
  return async (c) => {
    const parsedId = parseFormId(c.req.valid("param").id);
    if (!parsedId.ok) throw fail.invalidId();
    const formId: FormId = parsedId.value;

    const body = c.req.valid("json");
    const definition = requireFormDefinition(body.definition);

    const proposed = body.newQuestions.map((entry) => {
      const checked = checkQuestionDefinition(entry.definition);
      if (!checked.ok) {
        const questionId = proposedIdOf(entry.definition);
        logRefusal(deps, formId, questionId, "INVALID_QUESTION_DEFINITION", checked.issues);
        throw fail.proposedQuestionRefused(questionId, checked.issues);
      }
      return {
        definition: checked.definition,
        slug: entry.slug ?? slugFor(checked.definition.questionId),
      };
    });

    // Outside the transaction because these reads are on the environment pools and a
    // transaction is one connection (ADR-40).
    for (const question of proposed) {
      try {
        await requireUnusedQuestionId(deps.databases, question.definition.questionId);
      } catch (error) {
        logRefusal(deps, formId, question.definition.questionId, codeOf(error), []);
        throw error;
      }
    }

    // The form's own workspace is the only one whose questions this form may newly pin
    // without the publish rule refusing them (ADR-41).
    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    const stored = await deps.databases.control.transaction(async (tx) => {
      const created: CreatedQuestion[] = [];
      for (const question of proposed) {
        // Sequential: these share one connection handle, and a collision must name its question.
        try {
          created.push(
            await createQuestionWithFirstDraft(tx, {
              ...question,
              workspaceId: form.workspaceId,
            }),
          );
        } catch (error) {
          // Logged here rather than in `create.ts`, which stays loggerless for its other caller.
          logRefusal(deps, formId, question.definition.questionId, codeOf(error), []);
          throw error;
        }
      }
      const draft = await storeDraftDefinition(tx, formId, definition, true);
      return { created, draft };
    });

    deps.logger.info("agent proposal accepted", {
      formId,
      createdQuestions: stored.created.length,
    });

    // After the commit, so it sees the drafts this accept just created.
    const { issues, warnings } = await validateDraft(deps, definition);

    return c.json(
      {
        draft: definition,
        issues,
        warnings: [...warnings],
        agentAssisted: stored.draft.agentAssisted,
        updatedAt: stored.draft.updatedAt.toISOString(),
        createdQuestions: stored.created.map(({ question, version }) => ({
          questionId: question.questionId,
          slug: question.slug,
          version: version.version,
          // Always a draft: accept creates, it never publishes (ADR-25).
          status: "draft" as const,
        })),
      },
      200,
    );
  };
}
