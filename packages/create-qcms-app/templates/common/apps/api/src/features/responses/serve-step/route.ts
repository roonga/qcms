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
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("responses:write"),
});

/** An internal contract with no stability promise: the portal BFF is its only caller. */
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
    // 422 refuses the whole request; a per-entry refusal rides in the 200's `rejected`.
    ...errorResponses(400, 401, 404, 409, 422, 429),
  },
  ...withScopes("responses:write"),
});

/** Commits no answers, and its one-time operation token makes a replayed post a no-op. */
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
    ...errorResponses(400, 401, 404, 409, 429),
  },
  ...withScopes("responses:write"),
});

export const registerServeStep: SliceRegistrar = (group, deps: Deps): void => {
  group.use("/sessions/:id/answers", answersPerSessionLimiter(deps));
  group.use("/sessions/:id/answers", answersPerIpLimiter(deps));
  // The batch spends the per-session answer allowance per entry in its own handler
  // (SEC-16), so mounting that limiter here too would charge it an extra unit.
  group.use("/sessions/:id/answers/batch", answersPerIpLimiter(deps));
  group.use("/sessions/:id/roster", rosterPerSessionLimiter(deps));
  group.use("/sessions/:id/roster", rosterPerIpLimiter(deps));
  group.openapi(getStepRoute, makeGetStepHandler(deps));
  group.openapi(submitAnswerRoute, makeSubmitAnswerHandler(deps));
  group.openapi(batchAnswersRoute, makeBatchAnswersHandler(deps));
  group.openapi(rosterOpRoute, makeRosterOpHandler(deps));
};
