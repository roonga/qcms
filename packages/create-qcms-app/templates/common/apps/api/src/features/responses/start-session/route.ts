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
  // A respondent *write* endpoint (creates a session): SEC-5 `responses:write`,
  // not the `responses:read` it borrowed before the scope existed (issue #7).
  ...withScopes("responses:write"),
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
    // 400: a session id that is not well-formed is refused by the route schema.
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:read"),
});

/** Register the start-session routes on a public surface group. */
export const registerStartSession: SliceRegistrar = (group, deps: Deps): void => {
  // Session creation is rate-limited per client IP (task 026): no session
  // exists yet, so IP is the only available bucket. Scoped to exactly the
  // `POST /sessions` path (Hono matches the bare path, not sub-paths).
  //
  // The limiter stays as middleware, ahead of the handler, and issue #376 asked
  // whether it should move behind token validation instead so an invalid token
  // allocates nothing. It must not, for two reasons. The anonymous mode
  // (`{ formSlug }`) has no token to validate at all, and capping *that* is the
  // limiter's main job, so a limiter that only runs after validation would leave
  // the primary path uncapped. And validation is exactly the work the limiter
  // exists to shield: the secure-link path does a signature verify plus a
  // `secure_links` read, and consuming a one-time link is a write, so running
  // the limiter afterwards would let an unauthenticated caller drive unbounded
  // database round trips with junk tokens. The allocation this position permits
  // is bounded in the store instead (`rate-limit.ts`).
  group.use("/sessions", sessionCreateLimiter(deps));
  group.openapi(startSessionRoute, makeStartSessionHandler(deps));
  group.openapi(getSessionRoute, makeGetSessionHandler(deps));
};
