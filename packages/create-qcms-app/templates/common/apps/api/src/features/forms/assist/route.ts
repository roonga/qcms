import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, jsonBody, withScopes, type ApiEnv } from "../../../openapi.js";
import { clientAddress } from "../../../client-address.js";
import { rateLimit } from "../../../rate-limit.js";
import { FormIdParam } from "../schema.js";
import { makeAcceptProposalHandler, makeAssistHandler } from "./handler.js";
import { AcceptProposalBody, AcceptProposalResponse, AssistBody } from "./schema.js";

const tags = ["forms"];

export const assistRoute = createRoute({
  method: "post",
  path: "/forms/{id}/draft/assist",
  summary: "Ask the draft assistant for a proposal; streams progress as SSE (admin, flag-gated)",
  description:
    "One agent turn over the form's current draft. The response is a `text/event-stream` of " +
    "assist events; the terminal `proposal` event carries the proposed draft, any proposed new " +
    "questions, a rationale, and the advisory publish issues the server computed for it. " +
    "The agent can never publish: accepting a proposal stores a draft and unpublished question " +
    "drafts, and a human publishes them.",
  tags,
  request: {
    params: FormIdParam,
    body: jsonBody(AssistBody),
  },
  responses: {
    // No content schema: the handler returns a raw SSE Response.
    200: { description: "Server-sent event stream of assist events" },
    ...errorResponses(400, 401, 404, 409, 429),
  },
  ...withScopes("forms:write"),
});

/**
 * Its own route rather than a field on the draft save: accept needs `questions:write`,
 * and the gated mount keeps a second question-creation path out of a default build.
 */
export const acceptProposalRoute = createRoute({
  method: "post",
  path: "/forms/{id}/draft/assist/accept",
  summary:
    "Accept an agent proposal: save the draft and create its new questions (admin, flag-gated)",
  description:
    "Stores the accepted draft with agent provenance and materialises the proposal's new " +
    "question definitions as UNPUBLISHED question drafts in the library, in one transaction. " +
    "Each definition passes the same kernel and authoring-boundary validation " +
    "`POST /admin/questions` applies; a refused definition fails the whole accept and nothing " +
    "is written. Publishing the created drafts stays a separate human act (ADR-25).",
  tags,
  request: {
    params: FormIdParam,
    body: jsonBody(AcceptProposalBody),
  },
  responses: {
    200: {
      description: "The saved draft, its advisory issues, and the question drafts created",
      content: { "application/json": { schema: AcceptProposalResponse } },
    },
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("forms:write", "questions:write"),
});

function assistLimiter(deps: Deps) {
  const { windowMs, max } = deps.config.rateLimit.agentAssist;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => {
      // The address fallback keeps the key total when a principal is missing.
      const principal = (c as Context<ApiEnv>).get("adminPrincipal");
      return `rl:agent-assist:${principal?.userId ?? clientAddress(c)}`;
    },
  });
}

export const registerFormsAssist: SliceRegistrar = (group, deps: Deps): void => {
  if (deps.config.agent.provider === "none") return;
  // Hono matches a `use` path exactly unless it ends in `*`, so this bounds turns and
  // deliberately not accepts, which make no upstream provider call.
  group.use("/forms/:id/draft/assist", assistLimiter(deps));
  group.openapi(assistRoute, makeAssistHandler(deps));
  group.openapi(acceptProposalRoute, makeAcceptProposalHandler(deps));
};
