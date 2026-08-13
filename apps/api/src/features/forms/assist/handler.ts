/**
 * `POST /admin/forms/{id}/draft/assist` - one agent turn, relayed as SSE (041).
 *
 * The slice's job is narrow and deliberate: build the tightly bounded
 * {@link AssistContext} an assistant is allowed to see, relay its events to the
 * browser, and guarantee that whatever comes back has been through 022's
 * validation on this side of the wire. It does not decide anything about the
 * proposal; that is the human's job, in the builder, through the normal draft
 * save (ADR-25).
 */

import type { RouteHandler } from "@hono/zod-openapi";

import { getDraft, getQuestionVersion, listQuestionVersions, listQuestions } from "@qcms/db";
import { parseFormId, type FormDefinition, type FormId, type QuestionId } from "@qcms/core";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import { validateDraft } from "../handler.js";
import type { assistRoute } from "./route.js";
import type { AssistContext, AssistEvent, AssistTurn, LibraryEntry } from "./types.js";

const fail = {
  formNotFound: (): ApiError => new ApiError("NOT_FOUND", 404, "No such form"),
  noDraft: (): ApiError =>
    new ApiError("NOT_FOUND", 404, "This form has no draft to work on yet"),
  invalidId: (): ApiError => new ApiError("INVALID_ID", 400, "Malformed form id"),
  staleDraft: (): ApiError =>
    new ApiError(
      "DRAFT_STALE",
      409,
      "The draft changed since this conversation started; reload the builder and try again",
    ),
};

/**
 * The published question library, as a search port.
 *
 * "Published" is load-bearing. A question the author is still drafting is not
 * pinnable, so proposing it would only produce a validation issue; the agent is
 * shown the same library the builder's pin picker shows.
 */
function questionLibrary(deps: Deps) {
  return {
    async search(query: string | undefined, limit: number): Promise<readonly LibraryEntry[]> {
      const needle = query?.trim().toLowerCase();
      const summaries = await listQuestions(deps.db);
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

async function latestPublished(
  deps: Deps,
  questionId: QuestionId,
  slug: string,
): Promise<LibraryEntry | undefined> {
  const versions = await listQuestionVersions(deps.db, questionId);
  const published = versions
    .filter((v) => v.status === "published")
    .sort((a, b) => b.version - a.version)[0];
  if (published === undefined) return undefined;
  const row = await getQuestionVersion(deps.db, questionId, published.version);
  if (row === undefined) return undefined;
  return { questionId, slug, version: row.version, definition: row.definition };
}

/** The client-state token: the draft's own `updatedAt`, stringified. */
function draftToken(updatedAt: Date): string {
  return updatedAt.toISOString();
}

/** Build the one context object a turn is allowed to touch. */
function buildContext(
  deps: Deps,
  draft: FormDefinition,
  conversation: readonly AssistTurn[],
): AssistContext {
  return {
    draft,
    questionLibrary: questionLibrary(deps),
    conversation,
    validate: async (definition) => (await validateDraft(deps, definition)).issues,
    maxSteps: deps.config.agent.provider === "none" ? 1 : deps.config.agent.maxSteps,
  };
}

const encoder = new TextEncoder();

/** One SSE frame. `event:` carries the discriminant so a client can switch on it. */
function frame(event: AssistEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * Relay the assistant's events as an SSE body.
 *
 * A web `ReadableStream` (R4: no Node streams), aborted when the client goes
 * away so a browser tab closing stops the upstream call rather than leaving it
 * billing away.
 */
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
    const draftRow = await getDraft(deps.db, formId);
    if (draftRow === undefined) throw fail.noDraft();
    if (body.clientState !== undefined && body.clientState !== draftToken(draftRow.updatedAt)) {
      throw fail.staleDraft();
    }

    const controller = new AbortController();
    // The request's own signal is the client's disconnect: relay it upstream.
    c.req.raw.signal.addEventListener("abort", () => {
      controller.abort();
    });

    const ctx = buildContext(deps, draftRow.definition, body.conversation);

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
