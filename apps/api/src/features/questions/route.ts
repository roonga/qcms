import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeCreateQuestionHandler,
  makeCreateVersionHandler,
  makeDeprecateVersionHandler,
  makeEditVersionHandler,
  makeGetQuestionHandler,
  makeListQuestionsHandler,
  makePreviewQuestionVersionHandler,
  makePublishVersionHandler,
} from "./handler.js";
import {
  CreatedQuestionResponse,
  CreateQuestionBody,
  EditVersionBody,
  ListQuestionsQuery,
  ListQuestionsResponse,
  PreviewQuestionVersionQuery,
  QuestionDetailResponse,
  QuestionIdParam,
  QuestionPreviewResponse,
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
    body: jsonBody(CreateQuestionBody),
  },
  responses: {
    201: {
      description: "The created question and its first draft version",
      content: { "application/json": { schema: CreatedQuestionResponse } },
    },
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
    body: jsonBody(EditVersionBody),
  },
  responses: {
    200: {
      description: "The updated draft version",
      content: { "application/json": { schema: QuestionVersionView } },
    },
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
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("questions:write"),
});

export const listQuestionsRoute = createRoute({
  method: "get",
  path: "/questions",
  summary:
    "List questions with a latest-version summary, or every version with `?versions=all`; filter by status and type, search slug/label (admin)",
  tags,
  request: { query: ListQuestionsQuery },
  responses: {
    200: {
      description: "The question library",
      content: { "application/json": { schema: ListQuestionsResponse } },
    },
    ...errorResponses(400, 401),
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
 * A read, and deliberately not the serving path: it recompiles a possibly-unpublished
 * draft, while the portal serves the stored compiled document from a pinned snapshot
 * (ADR-18).
 */
export const previewQuestionVersionRoute = createRoute({
  method: "get",
  path: "/questions/{id}/versions/{v}/preview",
  summary: "Compile one question version to a single-question A2UI preview document (admin)",
  tags,
  request: { params: VersionParam, query: PreviewQuestionVersionQuery },
  responses: {
    200: {
      description: "The single-question A2UI document, with the ADR-18 version stamps",
      content: { "application/json": { schema: QuestionPreviewResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("questions:read"),
});

/** `registerAdminAuth` must precede this in the admin bucket so the auth gate runs first. */
export const registerQuestions: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(createQuestionRoute, makeCreateQuestionHandler(deps));
  group.openapi(createVersionRoute, makeCreateVersionHandler(deps));
  group.openapi(editVersionRoute, makeEditVersionHandler(deps));
  group.openapi(publishVersionRoute, makePublishVersionHandler(deps));
  group.openapi(deprecateVersionRoute, makeDeprecateVersionHandler(deps));
  group.openapi(listQuestionsRoute, makeListQuestionsHandler(deps));
  group.openapi(getQuestionRoute, makeGetQuestionHandler(deps));
  group.openapi(previewQuestionVersionRoute, makePreviewQuestionVersionHandler(deps));
};
