import type { RouteHandler } from "@hono/zod-openapi";

import {
  getDraft,
  getLatestPublishedVersion,
  listQuestionVersions,
  listQuestions,
} from "@roonga/qcms-db";
import { getForm } from "@roonga/qcms-db";
import type { QuestionRow, QuestionVersionRow } from "@roonga/qcms-db";
import { parseFormId, type FormDefinition, type FormId, type QuestionId } from "@roonga/qcms-core";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import {
  checkQuestionDefinition,
  createQuestionWithFirstDraft,
  requireUnusedQuestionId,
  type DefinitionRefusal,
} from "../../questions/create.js";
import { requireFormDefinition, storeDraftDefinition, validateDraft } from "../handler.js";
import type { acceptProposalRoute, assistRoute } from "./route.js";
import type { AssistContext, AssistEvent, AssistTurn, LibraryEntry } from "./types.js";

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
    maxSteps: deps.config.agent.provider === "none" ? 1 : deps.config.agent.maxSteps,
  };
}

const encoder = new TextEncoder();

function frame(event: AssistEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** Aborted when the client goes away, so a closed tab stops the upstream call. */
function assistStream(
  deps: Deps,
  ctx: AssistContext,
  controller: AbortController,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(stream) {
      try {
        for await (const event of deps.draftAssistant.assist(ctx, controller.signal)) {
          stream.enqueue(frame(event));
        }
      } catch (error) {
        deps.logger.error("draft assist stream failed", {
          reason: error instanceof Error ? error.name : "unknown",
        });
        stream.enqueue(
          frame({
            type: "error",
            code: "PROVIDER_ERROR",
            message: "The assistant stopped unexpectedly.",
          }),
        );
      } finally {
        stream.close();
      }
    },
    cancel() {
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

    const controller = new AbortController();
    // The request's own signal is the client's disconnect: relay it upstream.
    c.req.raw.signal.addEventListener("abort", () => {
      controller.abort();
    });

    const ctx = buildContext(deps, definition, body.conversation);

    return new Response(assistStream(deps, ctx, controller), {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        // Proxies that buffer would defeat the point of streaming progress.
        "x-accel-buffering": "no",
      },
    });
  };
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
