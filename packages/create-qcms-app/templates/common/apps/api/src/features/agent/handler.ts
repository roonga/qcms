import type { RouteHandler } from "@hono/zod-openapi";

import {
  getDraft,
  getLatestPublishedVersion,
  listQuestionVersions,
  listQuestions,
  listWorkspaces,
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
import { requireFormDefinition, storeDraftDefinition, validateDraft } from "../forms/handler.js";
import type { Resource } from "../membership/policy.js";
import { PRODUCTION_ENVIRONMENT } from "../membership/policy.js";
import { holdsInstallationClaim, type ResolvedMembership } from "../membership/resolver.js";
import { savedDraftPins } from "./draft-pins.js";
import { offeredActionKinds, offersNoAction, type OfferedActionKind } from "./grant-filter.js";
import { buildProposal } from "./tools/propose.js";
import {
  AGENT_PROPOSE_TOOL_NAMES,
  AGENT_READ_TOOL_NAMES,
  isClaimTool,
  stagesForApplyDraft,
  toolCell,
  type AgentToolName,
} from "./tools/registry.js";
import { readPorts } from "./contexts/reads.js";
import {
  callerWorkspaces,
  forbidden,
  holdsCellIn,
  requireForm,
  type ScreenBuildInput,
  type ScreenParams,
} from "./contexts/support.js";
import { isFormSubtreeScreen, isScreenId, SCREENS, type ScreenId } from "./screens.js";
import { actionResultRefusal, type ConversationTurnBody } from "./schema.js";
import type { acceptProposalRoute, assistRoute, screenAssistRoute } from "./route.js";
import type { AgentContext, AssistEvent, AssistTurn, LibraryEntry } from "./types.js";

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
  resultNotAllowlisted: (reason: string): ApiError =>
    new ApiError("ACTION_RESULT_NOT_ALLOWED", 400, reason),
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

/** The one screen that runs a staged draft, through the builder's own save. */
const BUILDER_SCREEN: ScreenId = "/forms/[formId]";

function maxStepsFor(deps: Deps): number {
  return deps.config.agent.provider === "none" ? 1 : deps.config.agent.maxSteps;
}

/**
 * The turn's context: the screen's facts, the default subject ids a call takes when it
 * names none, and the ports behind every tool this caller's grants reach. The facts are
 * parsed rather than trusted, so an undeclared field fails here, not at the provider.
 */
async function buildScreenContext(args: {
  readonly deps: Deps;
  readonly screen: ScreenId;
  readonly build: ScreenBuildInput;
  readonly conversation: readonly AssistTurn[];
  /** The screen's own form draft, resolved after its cell check, for the preamble. */
  readonly draft?: () => Promise<FormDefinition | undefined>;
}): Promise<AgentContext> {
  const screen = SCREENS[args.screen];
  const facts = screen.facts.parse(await screen.build(args.build));
  const draft = await args.draft?.();
  const reads = readPorts(args.build);
  const held = await callerWorkspaces(args.build);
  const actions = actionPorts({ deps: args.deps, build: args.build, screen: args.screen, held });
  return {
    screen: args.screen,
    facts,
    defaults: {
      formId: args.build.params.formId,
      questionId: args.build.params.questionId,
      workspaceId: args.build.params.workspaceId,
      environment: args.build.environment,
    },
    conversation: args.conversation,
    maxSteps: maxStepsFor(args.deps),
    // The caller's own permissions, not the screen's: the whole point of the principle's
    // point 1 and point 5.
    tools: [...grantedReadTools(args.build, args.screen, held), ...actions.tools],
    // The same evaluator the route middleware uses. It asks whether this caller holds the
    // cell on any subject at all; the port re-asks it on the subject the call names, and
    // that is the limit.
    authorize: async (cell) => {
      await Promise.resolve();
      if (
        !holdsCellIn(held, args.build.environment, { ...cell, resource: cell.resource as Resource })
      )
        throw forbidden(
          `This needs a grant carrying ${cell.resource}: ${cell.action} in some workspace. ` +
            "Your own grants are at GET /admin/me/access.",
        );
    },
    questionLibrary: questionLibrary(args.deps),
    ...(draft === undefined ? {} : { draft }),
    ...reads,
    ...actions.ports,
  };
}

/**
 * The read tools this caller holds a cell for. The screen decides one thing only: a tool
 * that stages for the apply-draft card exists where that card does, since the builder is
 * what runs it.
 */
function grantedReadTools(
  build: ScreenBuildInput,
  screen: ScreenId,
  held: readonly ResolvedMembership[],
): readonly AgentToolName[] {
  return AGENT_READ_TOOL_NAMES.filter((name) => {
    if (stagesForApplyDraft(name) && screen !== BUILDER_SCREEN) return false;
    if (isClaimTool(name)) return build.principal.claim;
    const cell = toolCell(name);
    if (cell === undefined) return true;
    return holdsCellIn(held, build.environment, {
      resource: cell.resource as Resource,
      action: cell.action,
    });
  });
}

/** The union across the caller's workspaces: a kind held in one of them is offered. */
function mergeOffers(
  offers: readonly (readonly OfferedActionKind[])[],
): readonly OfferedActionKind[] {
  const byKind = new Map<string, Set<string>>();
  for (const offer of offers) {
    for (const entry of offer) {
      const environments = byKind.get(entry.kind) ?? new Set<string>();
      for (const environment of entry.environments) environments.add(environment);
      byKind.set(entry.kind, environments);
    }
  }
  return [...byKind.entries()].map(([kind, environments]) => ({
    kind,
    environments: [...environments],
  }));
}

/**
 * The propose tools' port and the kinds the grant filter offered this caller, across every
 * workspace they hold a grant in. A caller holding none gets neither the port nor the
 * tools, which is how "a read-only user is offered no write" is structural (point 1).
 */
function actionPorts(args: {
  readonly deps: Deps;
  readonly build: ScreenBuildInput;
  readonly screen: ScreenId;
  readonly held: readonly ResolvedMembership[];
}): {
  readonly tools: readonly AgentToolName[];
  readonly ports: Partial<Pick<AgentContext, "propose" | "offeredActionKinds">>;
} {
  const offered = mergeOffers(
    args.held.map((membership) =>
      offeredActionKinds({
        memberRole: membership.memberRole,
        grants: membership.grants,
        environments: args.deps.databases.names,
        current: args.build.environment,
        formId: args.build.params.formId,
        screen: args.screen,
      }),
    ),
  );
  // Present with an empty list rather than absent, so the system prompt can say this user
  // changes nothing anywhere.
  if (offersNoAction(offered)) return { tools: [], ports: { offeredActionKinds: offered } };

  const named = args.build.params.formId;
  const parsedForm = named === undefined ? undefined : parseFormId(named);
  const screenForm = parsedForm?.ok === true ? parsedForm.value : undefined;
  const workspaceId = screenForm === undefined ? args.build.params.workspaceId : undefined;
  return {
    tools: AGENT_PROPOSE_TOOL_NAMES,
    ports: {
      offeredActionKinds: offered,
      propose: async (input) =>
        buildProposal({
          ...input,
          subject: args.build.principal.userId,
          appKey: args.deps.config.keys.app,
          current: args.build.environment,
          offered,
          savedDraft: (formId) => savedDraftsFor(args.deps, formId),
          requireSecondApprover: await secondApproverFor(args.deps, {
            formId: screenForm,
            workspaceId,
          }),
          productionEnvironment: PRODUCTION_ENVIRONMENT,
          formId: named,
          issuedAt: args.deps.clock.now(),
          validate: (definition, pending) => validateDraft(args.deps, definition, pending),
        }),
    },
  };
}

/** The saved draft of whichever form the plan publishes, parsed rather than trusted. */
async function savedDraftsFor(deps: Deps, formId: string) {
  const parsed = parseFormId(formId);
  return parsed.ok ? savedDraftPins(deps, parsed.value) : undefined;
}

/**
 * ADR-41's two-person switch belongs to the workspace the act lands in. A plan proposed
 * from a screen with no subject names its form in the step's arguments, so the strictest
 * reading is taken: any workspace the caller may act in that requires it.
 */
async function secondApproverFor(
  deps: Deps,
  subject: { readonly formId: FormId | undefined; readonly workspaceId: string | undefined },
): Promise<boolean> {
  if (subject.formId !== undefined) {
    const form = await getForm(deps.databases.control, subject.formId);
    if (form === undefined) return true;
    return (
      (await getWorkspace(deps.databases.control, form.workspaceId))?.requireSecondApprover === true
    );
  }
  if (subject.workspaceId !== undefined) {
    return (
      (await getWorkspace(deps.databases.control, subject.workspaceId))?.requireSecondApprover ===
      true
    );
  }
  return (await listWorkspaces(deps.databases.control)).some(
    (workspace) => workspace.requireSecondApprover,
  );
}

function screenBuildInput(args: {
  readonly deps: Deps;
  readonly principal: { readonly userId: string; readonly claim: boolean };
  readonly environment: string;
  readonly params: ScreenParams;
  readonly conversationId: string | undefined;
  readonly visitId: string | undefined;
}): ScreenBuildInput {
  return {
    deps: args.deps,
    principal: args.principal,
    environment: args.environment,
    params: args.params,
    // A turn with no conversation id is deduplicated against nothing, so an audited read
    // writes its row every time rather than sharing a forged key.
    conversationId: args.conversationId ?? `turn:${crypto.randomUUID()}`,
    // A client that names no stay keeps the conversation-wide key it had before.
    visitId: args.visitId ?? "",
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
    requireAllowedResults(body.conversation);

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

    c.req.raw.signal.addEventListener("abort", () => {
      controller.abort();
    });

    const ctx = await buildScreenContext({
      deps,
      screen,
      conversation: body.conversation,
      draft: () => Promise.resolve(definition),
      build: screenBuildInput({
        deps,
        principal: callerOf(c),
        environment: deps.databases.forRequest(c.get("requestEnvironment")).environment,
        // The form the route names wins over anything a body says, so a turn cannot ask
        // about another form.
        params: { ...(body.params ?? {}), formId },
        conversationId: body.conversationId,
        visitId: body.visitId,
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

function requireAllowedResults(conversation: readonly ConversationTurnBody[]): void {
  const refusal = actionResultRefusal(conversation);
  if (refusal !== undefined) throw fail.resultNotAllowlisted(refusal);
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
 * The turn for a screen with no form in its route. One screen id, one context builder, one door: the
 * caller's grants decide what this turn may read, and the builder checks its own permission cell before it
 * reads the facts.
 */
export function makeScreenAssistHandler(
  deps: Deps,
): RouteHandler<typeof screenAssistRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    requireAllowedResults(body.conversation);
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
      visitId: body.visitId,
    });
    const ctx = await buildScreenContext({
      deps,
      screen,
      conversation: body.conversation,
      build,
      ...(build.params.formId === undefined ? {} : { draft: () => screenDraft(deps, build) }),
    });

    return new Response(assistStream(deps, ctx, controller), {
      status: 200,
      headers: sseHeaders(),
    });
  };
}

/**
 * The working definition of the form the screen names, for the preamble that asks for
 * changes. Every read and every verb resolves its own subject through its port, so this is
 * the screen's default and nothing more.
 */
async function screenDraft(
  deps: Deps,
  build: ScreenBuildInput,
): Promise<FormDefinition | undefined> {
  const { formId } = await requireForm(build);
  const draftRow = await getDraft(deps.databases.control, formId);
  return (
    draftRow?.definition ??
    (await getLatestPublishedVersion(deps.databases.control, formId))?.definition
  );
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
 * Every refusal takes this path, so one event name counts them together and tells them apart by `reason`.
 * Ids and codes only, never the definition itself.
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
