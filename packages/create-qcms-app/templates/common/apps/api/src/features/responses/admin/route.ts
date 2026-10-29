/**
 * Unflag carries `responses:erase` rather than a read scope, so response-mutating
 * authority stays out of `responses:read` and `responses:export` (SEC-5).
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../../openapi.js";
import {
  makeEraseHandler,
  makeErasureScopeHandler,
  makeExportHandler,
  makeGetResponseHandler,
  makeListErasuresHandler,
  makeListResponsesHandler,
  makeUnflagHandler,
} from "./handler.js";
import {
  EraseBody,
  EraseResponse,
  ErasureScopeResponse,
  ErasuresResponse,
  ExportQuery,
  FormIdParam,
  FormResponseParams,
  ListErasuresQuery,
  ListResponsesQuery,
  ResponseDetailResponse,
  ResponseListResponse,
  FormSessionParams,
  UnflagResponse,
} from "./schema.js";

const tags = ["responses"];

export const listResponsesRoute = createRoute({
  method: "get",
  path: "/forms/{id}/responses",
  summary: "List submitted responses for a form (paginated, filterable) (admin)",
  tags,
  request: { params: FormIdParam, query: ListResponsesQuery },
  responses: {
    200: {
      description: "A page of submitted responses (erased sessions excluded)",
      content: { "application/json": { schema: ResponseListResponse } },
    },
    ...errorResponses(400, 401),
  },
  ...withScopes("responses:read"),
});

export const getResponseRoute = createRoute({
  method: "get",
  path: "/forms/{id}/responses/{sessionId}",
  summary: "Read one response: locked answers, audit ledger, content hash (admin)",
  tags,
  request: { params: FormResponseParams },
  responses: {
    200: {
      description: "The response detail with its append-only answer ledger",
      content: { "application/json": { schema: ResponseDetailResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:read"),
});

export const exportRoute = createRoute({
  method: "get",
  path: "/forms/{id}/export",
  summary: "Export submitted responses as CSV or JSON (streamed) (admin)",
  tags,
  request: { params: FormIdParam, query: ExportQuery },
  responses: {
    // No body schema: a content-typed response would not permit the raw stream.
    200: {
      description: "The export stream (text/csv or application/json; erased sessions excluded)",
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:export"),
});

export const eraseRoute = createRoute({
  method: "post",
  path: "/forms/{id}/responses/{sessionId}/erase",
  summary: "Erase a session's response (ADR-17); returns the tombstone (idempotent) (admin)",
  tags,
  request: {
    params: FormSessionParams,
    body: jsonBody(EraseBody),
  },
  responses: {
    200: {
      description: "The erasure tombstone (existence without content)",
      content: { "application/json": { schema: EraseResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:erase"),
});

export const erasureScopeRoute = createRoute({
  method: "get",
  path: "/forms/{id}/responses/{sessionId}/erasure-scope",
  summary:
    "Which environment an erasure acts in, and where else this subject has something (admin)",
  description:
    "An erasure acts in the selected environment only (ADR-17, Q7). This read says " +
    "which other environments in the live set hold something for the same subject " +
    "identifier, narrowed to the ones the caller may erase in, so the screen can offer " +
    "to repeat the erasure there - each repetition its own confirmed act in its own " +
    "environment. It returns existence and never content, and it erases nothing.",
  tags,
  request: { params: FormSessionParams },
  responses: {
    200: {
      description: "The selected environment and the other environments to offer",
      content: { "application/json": { schema: ErasureScopeResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:erase"),
});

export const listErasuresRoute = createRoute({
  method: "get",
  path: "/erasures",
  summary: "List erasure tombstones (compliance evidence) (admin)",
  tags,
  request: { query: ListErasuresQuery },
  responses: {
    200: {
      description: "The erasure tombstones, newest first",
      content: { "application/json": { schema: ErasuresResponse } },
    },
    ...errorResponses(400, 401),
  },
  ...withScopes("responses:read"),
});

export const unflagRoute = createRoute({
  method: "post",
  path: "/forms/{id}/responses/{sessionId}/unflag",
  summary: "Release a withheld (flagged) response's outbox event (admin)",
  tags,
  request: { params: FormSessionParams },
  responses: {
    200: {
      description: "Whether this call released the withheld response.submitted event",
      content: { "application/json": { schema: UnflagResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:erase"),
});

/** `registerAdminAuth` must precede this in the admin bucket so its gate runs first. */
export const registerAdminResponses: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(listResponsesRoute, makeListResponsesHandler(deps));
  group.openapi(getResponseRoute, makeGetResponseHandler(deps));
  group.openapi(exportRoute, makeExportHandler(deps));
  group.openapi(eraseRoute, makeEraseHandler(deps));
  group.openapi(erasureScopeRoute, makeErasureScopeHandler(deps));
  group.openapi(listErasuresRoute, makeListErasuresHandler(deps));
  group.openapi(unflagRoute, makeUnflagHandler(deps));
};
