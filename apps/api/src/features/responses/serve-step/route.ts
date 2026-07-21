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
import { errorResponses, withScopes } from "../../../openapi.js";
import { answersPerIpLimiter, answersPerSessionLimiter } from "../rate-limits.js";
import { makeGetStepHandler, makeSubmitAnswerHandler } from "./handler.js";
import { SessionParams, StepResponse, SubmitAnswerBody } from "./schema.js";

export const getStepRoute = createRoute({
  method: "get",
  path: "/sessions/{id}/step",
  summary: "Serve the current step's stored compiled UI and flow projection (session-token authed)",
  tags: ["responses"],
  request: { params: SessionParams },
  responses: {
    200: {
      description: "The current step document and client-safe flow projection",
      content: { "application/json": { schema: StepResponse } },
    },
    ...errorResponses(401, 404, 409),
  },
  ...withScopes("responses:read"),
});

export const submitAnswerRoute = createRoute({
  method: "post",
  path: "/sessions/{id}/answers",
  summary:
    "Submit one answer; validated, appended to the ledger, flow re-evaluated (session-token authed)",
  tags: ["responses"],
  request: {
    params: SessionParams,
    body: {
      required: true,
      content: { "application/json": { schema: SubmitAnswerBody } },
    },
  },
  responses: {
    200: {
      description: "The answer was recorded; the updated flow projection follows",
      content: { "application/json": { schema: StepResponse } },
    },
    ...errorResponses(401, 404, 409, 422),
  },
  // A respondent *write* endpoint (appends an answer): SEC-5 `responses:write`,
  // not the `responses:read` it borrowed before the scope existed (issue #7).
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
  group.openapi(getStepRoute, makeGetStepHandler(deps));
  group.openapi(submitAnswerRoute, makeSubmitAnswerHandler(deps));
};
