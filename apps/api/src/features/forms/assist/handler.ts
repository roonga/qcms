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

import {
  getDraft,
  getLatestPublishedVersion,
  listQuestionVersions,
  listQuestions,
} from "@roonga/qcms-db";
import { parseFormId, type FormDefinition, type FormId, type QuestionId } from "@roonga/qcms-core";

import type { Deps } from "../../../deps.js";
import { ApiError } from "../../../errors.js";
import type { ApiEnv } from "../../../openapi.js";
import {
  checkQuestionDefinition,
  createQuestionWithFirstDraft,
  type DefinitionRefusal,
} from "../../questions/create.js";
import { requireFormDefinition, storeDraftDefinition, validateDraft } from "../handler.js";
import type { acceptProposalRoute, assistRoute } from "./route.js";
import type { AssistContext, AssistEvent, AssistTurn, LibraryEntry } from "./types.js";

const fail = {
  noDraft: (): ApiError => new ApiError("NOT_FOUND", 404, "This form has no draft to work on yet"),
  invalidId: (): ApiError => new ApiError("INVALID_ID", 400, "Malformed form id"),
  staleDraft: (): ApiError =>
    new ApiError(
      "DRAFT_STALE",
      409,
      "The draft changed since this conversation started; reload the builder and try again",
    ),
  /**
   * A proposed definition the authoring boundary refused, named.
   *
   * The whole accept fails on this, and the sentence has to carry **which**
   * question and **why**: the operator is looking at a proposal card listing
   * several questions, and "the question definition is invalid" would leave them
   * to guess which one. The envelope code is the questions slice's own, so an
   * admin that already renders a refused create renders this unchanged.
   */
  proposedQuestionRefused: (questionId: string, issues: readonly DefinitionRefusal[]): ApiError =>
    new ApiError(
      "INVALID_QUESTION_DEFINITION",
      422,
      `Proposed question "${questionId}" was refused: ${issues[0]?.message ?? "the definition is invalid"} Nothing was saved.`,
      { questionId, issues },
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

/**
 * The newest **published** version of one question, or `undefined` if it has none.
 *
 * A single max scan, for two reasons worth stating because the obvious shapes are
 * both worse:
 *
 * - **It does not lean on the query's `ORDER BY`.** `listQuestionVersions` happens
 *   to return ascending today, but "newest published" is this function's own
 *   invariant, not the query helper's, and a helper is free to change its order
 *   without breaking its own contract. Re-sorting the returned rows would have
 *   been redundant *and* would have mutated an array the caller owns; picking the
 *   maximum is order-independent, so there is nothing to be redundant with.
 * - **It does not re-fetch the row.** `QuestionVersionRow` already carries the
 *   `definition`, so the earlier `getQuestionVersion` call was a second round trip
 *   for data already in hand - once per candidate, on a path that scans up to the
 *   search limit.
 */
async function latestPublished(
  deps: Deps,
  questionId: QuestionId,
  slug: string,
): Promise<LibraryEntry | undefined> {
  const versions = await listQuestionVersions(deps.db, questionId);
  let newest: (typeof versions)[number] | undefined;
  for (const version of versions) {
    if (version.status !== "published") continue;
    if (newest === undefined || version.version > newest.version) newest = version;
  }
  if (newest === undefined) return undefined;
  return { questionId, slug, version: newest.version, definition: newest.definition };
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
    // Both advisory channels, unedited. `validateDraft` is 022's own, so the
    // assistant's verdict is the builder's verdict over the same draft rather
    // than a second opinion that could disagree with it.
    validate: async (definition) => {
      const { issues, warnings } = await validateDraft(deps, definition);
      return { issues, warnings };
    },
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

    // The draft the agent works against is the one the builder shows: the open
    // draft if there is one, otherwise seeded from the latest published version
    // (the same read-time rule `GET /admin/forms/:id` applies). Without the
    // fallback, asking the assistant anything on a freshly published form would
    // 404 while the builder in front of the author is showing a draft.
    const draftRow = await getDraft(deps.db, formId);
    let definition: FormDefinition;
    if (draftRow === undefined) {
      const published = await getLatestPublishedVersion(deps.db, formId);
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

// --- POST /admin/forms/:id/draft/assist/accept ------------------------------

/**
 * The library slug a proposed question gets when the proposal does not name one.
 *
 * A `questionId` is `q_[a-z0-9_]+` (002), so dropping the prefix and spelling
 * the separators as hyphens always yields a usable slug: `q_first_name` becomes
 * `first-name`. Derived rather than invented so the operator can predict it, and
 * a collision with an existing slug is a clean `SLUG_TAKEN` 409 that fails the
 * whole accept rather than a silently mangled name.
 */
function slugFor(questionId: string): string {
  return questionId.replace(/^q_/, "").replace(/_/g, "-");
}

/**
 * The identity a refused definition is reported under, read positionally.
 *
 * The value failed to parse, so there is no kernel-blessed id to quote; the
 * `questionId` field is read off the raw object when it is a string precisely so
 * the operator hears the name the agent used. `"(unnamed)"` is the honest answer
 * when even that is missing.
 */
function proposedIdOf(value: unknown): string {
  const id = (value as { questionId?: unknown } | null)?.questionId;
  return typeof id === "string" && id !== "" ? id : "(unnamed)";
}

/**
 * Accept an agent proposal: store the draft **and** materialise the proposal's
 * new question definitions as unpublished drafts in the library (issue #823).
 *
 * ADR-25's third clause is the whole point. Before this route, accepting a
 * proposal that carried new questions saved a draft pinning ids nothing had ever
 * created: the builder honestly rendered "Version not found", the assistant
 * promised a `DANGLING_QUESTION_REF` that "will resolve once the question is
 * published", and there was no draft to publish. The human-publishes step has to
 * exist for the agent-proposes step to mean anything.
 *
 * **One transaction, not ordered-with-rollback.** Both writes are single-row
 * inserts through `@roonga/qcms-db` helpers that take an `Executor`, and this
 * slice owns the boundary (R5, `apps/api/CONTRIBUTING.md`), so the cheap correct
 * shape is the one the publish handler already uses: open a transaction, write
 * the questions, write the draft, and let a refusal roll the lot back. A draft
 * therefore never pins a question whose creation failed, and no compensating
 * delete has to be written or tested.
 *
 * **Kernel validation happens before the transaction opens.** Every proposed
 * definition goes through `checkQuestionDefinition`, the questions slice's own
 * door - the kernel parse plus the authoring-boundary refusals the kernel does
 * not carry, the #453-era `v`-flag pattern check among them. A proposal is an
 * authoring act by the human who pressed Accept, so it meets the boundary a
 * hand-authored question meets. Validating first means a refusal costs no
 * database work at all, and the operator is told which question and why.
 *
 * The advisories then describe reality: the created drafts resolve, so the pins
 * stop being `DANGLING_QUESTION_REF` and become `UNPUBLISHED_QUESTION_PIN` until
 * the operator publishes them - which is exactly the resolution step the
 * assistant's narration promises.
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

    // Validate every proposed question first: no transaction is opened for a
    // proposal the boundary is going to refuse, and the refusal names it.
    const proposed = body.newQuestions.map((entry) => {
      const checked = checkQuestionDefinition(entry.definition);
      if (!checked.ok) {
        // Ids and codes, never the definition (SEC-8's habit applied to authoring
        // content too). A refused accept is the one outcome an operator cannot
        // reconstruct from the screen alone, because the proposal that caused it is
        // gone the moment they ask the assistant again.
        deps.logger.warn("agent proposal refused at the authoring boundary", {
          formId,
          questionId: proposedIdOf(entry.definition),
          issues: checked.issues.map((issue) => issue.code),
        });
        throw fail.proposedQuestionRefused(proposedIdOf(entry.definition), checked.issues);
      }
      return {
        definition: checked.definition,
        slug: entry.slug ?? slugFor(checked.definition.questionId),
      };
    });

    const stored = await deps.db.transaction(async (tx) => {
      const created = [];
      for (const question of proposed) {
        // Sequential rather than concurrent: these share one connection handle,
        // and an id or slug collision has to be attributable to a question.
        created.push(await createQuestionWithFirstDraft(tx, question));
      }
      const draft = await storeDraftDefinition(tx, formId, definition, true);
      return { created, draft };
    });

    deps.logger.info("agent proposal accepted", {
      formId,
      createdQuestions: stored.created.length,
    });

    // Advisory validation runs after the commit, so it sees the drafts this
    // accept just created - the count the panel shows is the truth about the
    // library, not about the library one transaction ago.
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
