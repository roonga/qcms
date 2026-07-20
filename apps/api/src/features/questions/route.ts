/**
 * Route definitions for the admin question-authoring slices (task 021).
 *
 * The headless question library, exposed on the **admin** surface. Every route
 * is declared with `@hono/zod-openapi` `createRoute` (017's mandatory
 * convention) so the generated OpenAPI documents (027) cannot drift, and each
 * carries its SEC-5 scope intent via `withScopes` — `questions:read` for the
 * reads, `questions:write` for the authoring mutations. Scopes are inert at
 * launch (the `/api/v1` surface is reserved); annotating them now makes Phase-4
 * activation wiring, not archaeology.
 *
 * The admin group is guarded by two middlewares before any route here runs: the
 * internal service-token gate (SEC-4, applied to every mounted group by the
 * composition root) and the admin-auth gate (`registerAdminAuth`, this task).
 * In a public-only process the admin group is not mounted at all, so these
 * paths simply do not exist — a request 404s, never 403s (ADR-09).
 *
 * There is **no delete route**: a question is deprecated, never removed (R6).
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import {
  makeCreateQuestionHandler,
  makeCreateVersionHandler,
  makeDeprecateVersionHandler,
  makeEditVersionHandler,
  makeGetQuestionHandler,
  makeListQuestionsHandler,
  makePublishVersionHandler,
} from "./handler.js";
import {
  CreatedQuestionResponse,
  CreateQuestionBody,
  EditVersionBody,
  ListQuestionsQuery,
  ListQuestionsResponse,
  QuestionDetailResponse,
  QuestionIdParam,
  QuestionVersionView,
  VersionParam,
} from "./schema.js";

const tags = ["questions"];

export const createQuestionRoute = createRoute({
  method: "post",
  path: "/questions",
  summary: "Create a question with its first draft version (admin)",
  tags,
  request: {
    body: { required: true, content: { "application/json": { schema: CreateQuestionBody } } },
  },
  responses: {
    201: {
      description: "The created question and its first draft version",
      content: { "application/json": { schema: CreatedQuestionResponse } },
    },
    // 409: questionId reused (R6) or slug taken. 422: invalid definition.
    ...errorResponses(400, 401, 409, 422),
  },
  ...withScopes("questions:write"),
});

export const createVersionRoute = createRoute({
  method: "post",
  path: "/questions/{id}/versions",
  summary: "Append a new draft version, seeded from the latest (admin)",
  tags,
  request: { params: QuestionIdParam },
  responses: {
    201: {
      description: "The new draft version",
      content: { "application/json": { schema: QuestionVersionView } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("questions:write"),
});

export const editVersionRoute = createRoute({
  method: "put",
  path: "/questions/{id}/versions/{v}",
  summary: "Edit a draft version's definition (admin); published/deprecated are immutable",
  tags,
  request: {
    params: VersionParam,
    body: { required: true, content: { "application/json": { schema: EditVersionBody } } },
  },
  responses: {
    200: {
      description: "The updated draft version",
      content: { "application/json": { schema: QuestionVersionView } },
    },
    // 409: the version is not a draft (VERSION_IMMUTABLE). 422: invalid definition.
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("questions:write"),
});

export const publishVersionRoute = createRoute({
  method: "post",
  path: "/questions/{id}/versions/{v}/publish",
  summary: "Publish a draft version, freezing its definition (admin)",
  tags,
  request: { params: VersionParam },
  responses: {
    200: {
      description: "The published version",
      content: { "application/json": { schema: QuestionVersionView } },
    },
    // 409: the version is not a draft (INVALID_VERSION_STATE).
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("questions:write"),
});

export const deprecateVersionRoute = createRoute({
  method: "post",
  path: "/questions/{id}/versions/{v}/deprecate",
  summary: "Deprecate a published version, blocking new pins (admin)",
  tags,
  request: { params: VersionParam },
  responses: {
    200: {
      description: "The deprecated version",
      content: { "application/json": { schema: QuestionVersionView } },
    },
    // 409: the version is not published (INVALID_VERSION_STATE).
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("questions:write"),
});

export const listQuestionsRoute = createRoute({
  method: "get",
  path: "/questions",
  summary:
    "List questions with a latest-version summary; filter by status, search slug/label (admin)",
  tags,
  request: { query: ListQuestionsQuery },
  responses: {
    200: {
      description: "The question library",
      content: { "application/json": { schema: ListQuestionsResponse } },
    },
    ...errorResponses(401),
  },
  ...withScopes("questions:read"),
});

export const getQuestionRoute = createRoute({
  method: "get",
  path: "/questions/{id}",
  summary: "Read one question with all its versions (admin)",
  tags,
  request: { params: QuestionIdParam },
  responses: {
    200: {
      description: "The question and every version, oldest first",
      content: { "application/json": { schema: QuestionDetailResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("questions:read"),
});

/**
 * Register every admin question route on an admin group. The admin-auth gate
 * (`registerAdminAuth`) must precede this in the admin bucket so it runs first.
 */
export const registerQuestions: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(createQuestionRoute, makeCreateQuestionHandler(deps));
  group.openapi(createVersionRoute, makeCreateVersionHandler(deps));
  group.openapi(editVersionRoute, makeEditVersionHandler(deps));
  group.openapi(publishVersionRoute, makePublishVersionHandler(deps));
  group.openapi(deprecateVersionRoute, makeDeprecateVersionHandler(deps));
  group.openapi(listQuestionsRoute, makeListQuestionsHandler(deps));
  group.openapi(getQuestionRoute, makeGetQuestionHandler(deps));
};
