/**
 * Route definitions for the serving-loop slice (task 019): `GET
 * /sessions/{id}/step` and `POST /sessions/{id}/answers`.
 *
 * Declared with `@hono/zod-openapi` `createRoute` (017's mandatory convention):
 * Zod request/response schemas and typed error responses, so the generated
 * OpenAPI documents (027) cannot drift. `withScopes` annotates the SEC-5 intent
 * for the reserved `/api/v1` surface; it rides in the document and enforces
 * nothing at launch.
 *
 * Both routes live on the **public** (respondent-facing) surface behind the
 * internal service-token guard (SEC-4) - only the portal BFF calls the API -
 * while the per-session credential is the session token both handlers verify.
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../../openapi.js";
import {
  answersPerIpLimiter,
  answersPerSessionLimiter,
  rosterPerIpLimiter,
  rosterPerSessionLimiter,
} from "../rate-limits.js";
import {
  makeBatchAnswersHandler,
  makeGetStepHandler,
  makeRosterOpHandler,
  makeSubmitAnswerHandler,
} from "./handler.js";
import {
  BatchAnswerBody,
  BatchAnswerResponse,
  RosterOpBody,
  RosterOpResponse,
  SessionParams,
  StepQuery,
  StepResponse,
  SubmitAnswerBody,
} from "./schema.js";

export const getStepRoute = createRoute({
  method: "get",
  path: "/sessions/{id}/step",
  summary: "Serve a step's stored compiled UI and flow projection (session-token authed)",
  tags: ["responses"],
  request: { params: SessionParams, query: StepQuery },
  responses: {
    200: {
      description: "The current step document and client-safe flow projection",
      content: { "application/json": { schema: StepResponse } },
    },
    // 400: a malformed session id or step query is refused by the route schema.
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("responses:read"),
});

export const submitAnswerRoute = createRoute({
  method: "post",
  path: "/sessions/{id}/answers",
  summary:
    "Submit one answer (or retract it with a null value); validated, appended to the ledger, flow re-evaluated (session-token authed)",
  tags: ["responses"],
  request: {
    params: SessionParams,
    query: StepQuery,
    body: jsonBody(SubmitAnswerBody),
  },
  responses: {
    200: {
      description: "The answer was recorded; the updated flow projection follows",
      content: { "application/json": { schema: StepResponse } },
    },
    // 400: the route schema refuses a malformed id, query or body shape before the
    // handler runs; 422 is the domain refusal of a well-formed answer.
    ...errorResponses(400, 401, 404, 409, 422),
  },
  // A respondent *write* endpoint (appends an answer): SEC-5 `responses:write`,
  // not the `responses:read` it borrowed before the scope existed (issue #7).
  ...withScopes("responses:write"),
});

/**
 * The batch answer write (task 073, Q20, ADR-43): one Continue's answers in one
 * request.
 *
 * It is an **internal contract with no stability promise** - the portal BFF is its only
 * caller and the SEC-4 channel token is what keeps that true - which is why it takes
 * the shape that suits a whole-step POST rather than a shape a third party would bind
 * to. It is documented in the generated respondent document like every other route on
 * this surface, because a route that exists and is undocumented is worse than one that
 * says what it is.
 *
 * **Rate limited per ENTRY, not per request** (SEC-16), from the same per-session
 * answer bucket the single-answer route spends from. The per-session half is spent in
 * the handler, where the validated entry count is known; only the per-IP backstop rides
 * as middleware here, because that one genuinely is per request.
 */
export const batchAnswersRoute = createRoute({
  method: "post",
  path: "/sessions/{id}/answers/batch",
  summary:
    "Submit a whole step's answers in one request, under one session lock (session-token authed)",
  tags: ["responses"],
  request: {
    params: SessionParams,
    query: StepQuery,
    body: jsonBody(BatchAnswerBody),
  },
  responses: {
    200: {
      description:
        "The batch was applied; the updated flow projection follows, with any refused entries listed",
      content: { "application/json": { schema: BatchAnswerResponse } },
    },
    // 422 is reserved for a refusal of the whole request; a per-entry refusal rides in
    // the 200's `rejected` array, because the entries around it were applied.
    ...errorResponses(400, 401, 404, 409, 422, 429),
  },
  ...withScopes("responses:write"),
});

/**
 * The roster operation (task 073, ADR-43): the respondent's Add or Remove.
 *
 * It commits **no answers**, it carries a one-time operation token so a replayed post
 * is a no-op, and it has its own rate limit beside the answer write (SEC-16), because
 * adding an instance is a distinct action that is cheap to repeat.
 */
export const rosterOpRoute = createRoute({
  method: "post",
  path: "/sessions/{id}/roster",
  summary:
    "Add or remove one instance of a repeating group; writes no answer (session-token authed)",
  tags: ["responses"],
  request: {
    params: SessionParams,
    query: StepQuery,
    body: jsonBody(RosterOpBody),
  },
  responses: {
    200: {
      description:
        "The roster operation was applied, or replayed as a no-op; the updated flow projection follows",
      content: { "application/json": { schema: RosterOpResponse } },
    },
    // 409 carries REPEAT_MAX_REACHED (the group is at the size its author allows) and
    // REPEAT_NOT_ADDABLE (its size is not the respondent's to change); 404 carries
    // UNKNOWN_GROUP.
    ...errorResponses(400, 401, 404, 409, 429),
  },
  ...withScopes("responses:write"),
});

/** Register the serving-loop routes on a public surface group. */
export const registerServeStep: SliceRegistrar = (group, deps: Deps): void => {
  // Answer submission is rate-limited per session (sustained + burst) and per
  // client IP (a wider flood backstop) - task 026. Both mount only on the
  // answers path; get-step is not throttled (idempotent read of stored UI).
  // This is the sole change to the 019 slice; its handler logic is untouched.
  group.use("/sessions/:id/answers", answersPerSessionLimiter(deps));
  group.use("/sessions/:id/answers", answersPerIpLimiter(deps));
  // The batch write (073) spends the per-session answer allowance PER ENTRY, inside
  // its handler where the validated entry count is known (SEC-16); mounting the
  // per-session middleware here as well would charge the batch one extra unit for
  // being one request. The per-IP backstop genuinely is per request and rides here.
  group.use("/sessions/:id/answers/batch", answersPerIpLimiter(deps));
  // The roster operation's own class, per session and per IP (SEC-16).
  group.use("/sessions/:id/roster", rosterPerSessionLimiter(deps));
  group.use("/sessions/:id/roster", rosterPerIpLimiter(deps));
  group.openapi(getStepRoute, makeGetStepHandler(deps));
  group.openapi(submitAnswerRoute, makeSubmitAnswerHandler(deps));
  group.openapi(batchAnswersRoute, makeBatchAnswersHandler(deps));
  group.openapi(rosterOpRoute, makeRosterOpHandler(deps));
};
