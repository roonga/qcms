/**
 * The two entry modes are separate registrars because a single route cannot be
 * half-mounted: anonymous entry is mounted on `prod`'s surface alone (SEC-14).
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
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:read"),
});

/**
 * The limiter runs ahead of the handler, not behind token validation: anonymous entry has
 * no token, and validation is the database work the limiter exists to shield.
 */
export const registerAnonymousEntry: SliceRegistrar = (group, deps: Deps): void => {
  group.use("/sessions", sessionCreateLimiter(deps));
  group.openapi(startSessionRoute, makeStartSessionHandler(deps));
};

/** The same IP bucket as anonymous entry: both create a session. */
export const registerLinkEntry: SliceRegistrar = (group, deps: Deps): void => {
  group.use("/sessions/link", sessionCreateLimiter(deps));
  group.openapi(startLinkSessionRoute, makeStartLinkSessionHandler(deps));
};

export const registerSessionStatus: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(getSessionRoute, makeGetSessionHandler(deps));
};
