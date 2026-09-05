/**
 * Route definition and registrar for the assist slice (041).
 *
 * **The flag gates the mount, not the handler.** When
 * `QCMS_FLAG_AGENT_AUTHORING=none` (the default) this registrar returns before
 * registering anything, so `/admin/forms/{id}/draft/assist` does not exist and a
 * request 404s - the same shape ADR-09 uses for an unmounted surface. There is
 * no "feature disabled" branch inside a handler that could be reached by a
 * misconfiguration, and a deployment with the flag off has no assist route in
 * its generated OpenAPI document either.
 *
 * This surface is deliberately **not** part of the frozen 027 core contract: it
 * is optional, flag-gated, and streams SSE rather than returning a modelled JSON
 * body.
 */

import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, withScopes, type ApiEnv } from "../../../openapi.js";
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
    body: { required: true, content: { "application/json": { schema: AssistBody } } },
  },
  responses: {
    // No content schema: the handler returns a raw SSE Response (web
    // ReadableStream, R4). Errors use the normal envelope.
    200: { description: "Server-sent event stream of assist events" },
    ...errorResponses(400, 401, 404, 409, 429),
  },
  ...withScopes("forms:write"),
});

/**
 * Accepting a proposal (issue #823).
 *
 * A route of its own rather than a field on `PUT /forms/{id}/draft`, and that is
 * the design decision this file records. Accept creates library questions, so
 * the surface that offers it needs `questions:write` as well as `forms:write` -
 * declaring both on the ordinary draft save would overstate what every keystroke
 * autosave requires. And accept is an agent-authoring capability: gating the
 * mount keeps it out of a default build entirely (ADR-09), where a field on the
 * core draft route would have handed every `forms:write` caller a second way to
 * create questions whether the flag was on or not.
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
    body: { required: true, content: { "application/json": { schema: AcceptProposalBody } } },
  },
  responses: {
    200: {
      description: "The saved draft, its advisory issues, and the question drafts created",
      content: { "application/json": { schema: AcceptProposalResponse } },
    },
    // 409: a proposed questionId was already used (R6) or its slug is taken.
    // 422: the draft or one of the proposed definitions did not validate.
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("forms:write", "questions:write"),
});

/**
 * Per-admin-principal ceiling on agent turns. Keyed by the authenticated
 * principal where there is one (the admin gate runs first), falling back to the
 * client address so a malformed-principal path still buckets somewhere.
 */
function assistLimiter(deps: Deps) {
  const { windowMs, max } = deps.config.rateLimit.agentAssist;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => {
      // The admin gate ran first, so a principal is present on the real path;
      // the address fallback keeps the key total.
      const principal = (c as Context<ApiEnv>).get("adminPrincipal");
      return `rl:agent-assist:${principal?.userId ?? clientAddress(c)}`;
    },
  });
}

export const registerFormsAssist: SliceRegistrar = (group, deps: Deps): void => {
  if (deps.config.agent.provider === "none") return;
  // Hono matches a `use` path exactly unless it ends in `*`, so the turn limiter
  // covers `/draft/assist` and not `/draft/assist/accept`. That is deliberate:
  // the ceiling exists to bound upstream provider calls, and an accept makes
  // none - it is an ordinary admin write, limited like every other one.
  group.use("/forms/:id/draft/assist", assistLimiter(deps));
  group.openapi(assistRoute, makeAssistHandler(deps));
  group.openapi(acceptProposalRoute, makeAcceptProposalHandler(deps));
};
