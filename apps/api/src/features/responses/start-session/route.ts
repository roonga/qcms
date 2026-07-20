/**
 * Route definitions for the start-session slice (task 018).
 *
 * Declared with `@hono/zod-openapi` `createRoute` (017's mandatory convention):
 * Zod request/response schemas and typed error responses, so the generated
 * OpenAPI documents (027) cannot drift from the implementation. `withScopes`
 * annotates the SEC-5 intent for the reserved `/api/v1` surface; it rides in the
 * document and enforces nothing at launch.
 *
 * Both routes live on the **public** (respondent-facing) surface. That surface
 * still sits behind the internal service-token guard (SEC-4) - only the portal
 * BFF calls the API - while the per-session credential is the session token the
 * `GET` route verifies.
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, withScopes } from "../../../openapi.js";
import { sessionCreateLimiter } from "../rate-limits.js";
import { makeGetSessionHandler, makeStartSessionHandler } from "./handler.js";
import {
  SessionParams,
  SessionStatusResponse,
  StartSessionBody,
  StartSessionResponse,
} from "./schema.js";

export const startSessionRoute = createRoute({
  method: "post",
  path: "/sessions",
  summary: "Start a respondent session (anonymous or via a secure link)",
  tags: ["responses"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: StartSessionBody } },
    },
  },
  responses: {
    201: {
      description: "Session created; the token authorizes every later respondent call",
      content: { "application/json": { schema: StartSessionResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("responses:read"),
});

export const getSessionRoute = createRoute({
  method: "get",
  path: "/sessions/{id}",
  summary: "Read a session's status and pinned version (session-token authed)",
  tags: ["responses"],
  request: { params: SessionParams },
  responses: {
    200: {
      description: "The session's current status view",
      content: { "application/json": { schema: SessionStatusResponse } },
    },
    ...errorResponses(401, 404),
  },
  ...withScopes("responses:read"),
});

/** Register the start-session routes on a public surface group. */
export const registerStartSession: SliceRegistrar = (group, deps: Deps): void => {
  // Session creation is rate-limited per client IP (task 026): no session
  // exists yet, so IP is the only available bucket. Scoped to exactly the
  // `POST /sessions` path (Hono matches the bare path, not sub-paths).
  group.use("/sessions", sessionCreateLimiter(deps));
  group.openapi(startSessionRoute, makeStartSessionHandler(deps));
  group.openapi(getSessionRoute, makeGetSessionHandler(deps));
};
