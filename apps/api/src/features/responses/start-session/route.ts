/**
 * Route definitions for the start-session slice (task 018).
 *
 * Declared with `@hono/zod-openapi` `createRoute` (017's mandatory convention):
 * Zod request/response schemas and typed error responses, so the generated
 * OpenAPI documents (027) cannot drift from the implementation. `withScopes`
 * annotates the SEC-5 intent for the reserved `/api/v1` surface; it rides in the
 * document and enforces nothing at launch.
 *
 * Every route here is respondent-facing, behind the internal service-token guard
 * (SEC-4) - only the portal BFF calls the API - while the per-session credential is
 * the session token the `GET` route verifies.
 *
 * **Three registrars rather than one, since task 066** (Q21, SEC-14, ADR-09's amended
 * Note), because the two entry modes have to ride different mount decisions:
 *
 *   - {@link registerAnonymousEntry} - `POST /sessions`, the form-slug door. Mounted on
 *     **`prod`'s surface alone**, so there is no anonymous entry to a non-prod
 *     environment on any address and the refusal is a `404` rather than a `403`.
 *   - {@link registerLinkEntry} - `POST /sessions/link`, the secure-link door. Mounted on
 *     **every** environment's surface, because a secure link is how a non-prod
 *     environment is reached at all.
 *   - {@link registerSessionStatus} - `GET /sessions/{id}`, the resume view, on every
 *     surface beside the loop it belongs to.
 *
 * The two entry routes were one route discriminated by a body refine, which is exactly
 * why the claim could not be structural before: one route cannot be half-mounted.
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../../openapi.js";
import { sessionCreateLimiter } from "../rate-limits.js";
import {
  makeGetSessionHandler,
  makeStartLinkSessionHandler,
  makeStartSessionHandler,
} from "./handler.js";
import {
  SessionParams,
  SessionStatusResponse,
  StartLinkSessionBody,
  StartSessionBody,
  StartSessionResponse,
} from "./schema.js";

export const startSessionRoute = createRoute({
  method: "post",
  path: "/sessions",
  summary: "Start an anonymous respondent session from a public form slug (prod only)",
  tags: ["responses"],
  request: {
    body: jsonBody(StartSessionBody),
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

export const startLinkSessionRoute = createRoute({
  method: "post",
  path: "/sessions/link",
  summary: "Start a respondent session from a secure link (every environment)",
  tags: ["responses"],
  request: {
    body: jsonBody(StartLinkSessionBody),
  },
  responses: {
    201: {
      description: "Session created; the token authorizes every later respondent call",
      content: { "application/json": { schema: StartSessionResponse } },
    },
    // 404 additionally covers a token whose link belongs to another environment: it is
    // presented under the wrong prefix, so there is no such link *here* (Q21).
    ...errorResponses(400, 401, 403, 404, 409),
  },
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

/**
 * Anonymous entry, on `prod`'s respondent surface alone (criterion 3).
 *
 * Session creation is rate-limited per client IP (task 026): no session exists yet, so
 * IP is the only available bucket. Scoped to exactly the `POST /sessions` path (Hono
 * matches the bare path, not sub-paths), and **installation-wide rather than per
 * environment** (finding 6): the limiter protects the one API process every environment
 * shares, so one bucket per address covers both entry doors.
 *
 * The limiter stays as middleware, ahead of the handler, and issue #376 asked
 * whether it should move behind token validation instead so an invalid token
 * allocates nothing. It must not, for two reasons. The anonymous mode has no
 * token to validate at all, and capping *that* is the limiter's main job, so a
 * limiter that only ran after validation would leave the primary path uncapped.
 * And validation is exactly the work the limiter exists to shield: the
 * secure-link path does a signature verify plus a `secure_links` read, and
 * consuming a one-time link is a write, so running the limiter afterwards would
 * let an unauthenticated caller drive unbounded database round trips with junk
 * tokens. The allocation this position permits is bounded in the store instead
 * (`rate-limit.ts`).
 */
export const registerAnonymousEntry: SliceRegistrar = (group, deps: Deps): void => {
  group.use("/sessions", sessionCreateLimiter(deps));
  group.openapi(startSessionRoute, makeStartSessionHandler(deps));
};

/**
 * Secure-link entry, on every environment's respondent surface.
 *
 * The same IP bucket as anonymous entry above, deliberately: both create a session, and
 * a second limiter class would be a second number to tune for one capability.
 */
export const registerLinkEntry: SliceRegistrar = (group, deps: Deps): void => {
  group.use("/sessions/link", sessionCreateLimiter(deps));
  group.openapi(startLinkSessionRoute, makeStartLinkSessionHandler(deps));
};

/** The resume/status read, on every environment's respondent surface. */
export const registerSessionStatus: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(getSessionRoute, makeGetSessionHandler(deps));
};
