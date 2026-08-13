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
import { makeAssistHandler } from "./handler.js";
import { AssistBody } from "./schema.js";

const tags = ["forms"];

export const assistRoute = createRoute({
  method: "post",
  path: "/forms/{id}/draft/assist",
  summary: "Ask the draft assistant for a proposal; streams progress as SSE (admin, flag-gated)",
  description:
    "One agent turn over the form's current draft. The response is a `text/event-stream` of " +
    "assist events; the terminal `proposal` event carries the proposed draft, any proposed new " +
    "questions, a rationale, and the advisory publish issues the server computed for it. " +
    "The agent can never publish: accepting a proposal is a normal draft save by the human.",
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
  group.use("/forms/:id/draft/assist", assistLimiter(deps));
  group.openapi(assistRoute, makeAssistHandler(deps));
};
