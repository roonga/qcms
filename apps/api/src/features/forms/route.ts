/**
 * Route definitions for the admin form-authoring slices (task 022).
 *
 * The form library, exposed on the **admin** surface. Every route is declared
 * with `@hono/zod-openapi` `createRoute` (017's mandatory convention) so the
 * generated OpenAPI documents (027) cannot drift, and each carries its SEC-5
 * scope intent via `withScopes` - `forms:read` for the reads, `forms:write` for
 * the authoring mutations (draft, publish, close/reopen). Scopes are inert at
 * launch (the `/api/v1` surface is reserved); annotating them now makes Phase-4
 * activation wiring, not archaeology.
 *
 * The admin group is guarded by two middlewares before any route here runs: the
 * internal service-token gate (SEC-4, applied to every mounted group by the
 * composition root) and the admin-auth gate (`registerAdminAuth`, 021). In a
 * public-only process the admin group is not mounted at all, so these paths
 * simply do not exist - a request 404s, never 403s (ADR-09).
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import {
  makeCloseFormHandler,
  makeCreateFormHandler,
  makeGetFormHandler,
  makeGetFormVersionHandler,
  makeListFormsHandler,
  makePublishFormHandler,
  makePutDraftHandler,
  makeReopenFormHandler,
  makeValidateDraftHandler,
} from "./handler.js";
import {
  CreateFormBody,
  CreatedFormResponse,
  DraftBody,
  FormDetailResponse,
  FormIdParam,
  FormStatusResponse,
  FormVersionParam,
  FormVersionSnapshotResponse,
  ListFormsResponse,
  PublishedResponse,
  SavedDraftResponse,
  ValidateDraftResponse,
} from "./schema.js";

const tags = ["forms"];

export const createFormRoute = createRoute({
  method: "post",
  path: "/forms",
  summary: "Create a form identity with an empty first draft (admin)",
  tags,
  request: {
    body: { required: true, content: { "application/json": { schema: CreateFormBody } } },
  },
  responses: {
    201: {
      description: "The created form and its empty draft",
      content: { "application/json": { schema: CreatedFormResponse } },
    },
    // 400: malformed formId/locale. 409: formId already in use.
    ...errorResponses(400, 401, 409),
  },
  ...withScopes("forms:write"),
});

export const listFormsRoute = createRoute({
  method: "get",
  path: "/forms",
  summary: "List forms with draft/published status (admin)",
  tags,
  responses: {
    200: {
      description: "The form library",
      content: { "application/json": { schema: ListFormsResponse } },
    },
    ...errorResponses(401),
  },
  ...withScopes("forms:read"),
});

export const getFormRoute = createRoute({
  method: "get",
  path: "/forms/{id}",
  summary: "Read one form: identity, current draft (open or seeded), version summary (admin)",
  tags,
  request: { params: FormIdParam },
  responses: {
    200: {
      description: "The form detail",
      content: { "application/json": { schema: FormDetailResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("forms:read"),
});

export const putDraftRoute = createRoute({
  method: "put",
  path: "/forms/{id}/draft",
  summary: "Replace the draft definition; returns advisory publish issues (admin)",
  tags,
  request: {
    params: FormIdParam,
    body: { required: true, content: { "application/json": { schema: DraftBody } } },
  },
  responses: {
    200: {
      description: "The saved draft and advisory validation issues",
      content: { "application/json": { schema: SavedDraftResponse } },
    },
    // 422: the body is not a parseable FormDefinition, or its formId mismatches.
    ...errorResponses(400, 401, 404, 422),
  },
  ...withScopes("forms:write"),
});

export const validateDraftRoute = createRoute({
  method: "post",
  path: "/forms/{id}/draft/validate",
  summary: "Dry-run publish validation of a definition; no save (admin)",
  tags,
  request: {
    params: FormIdParam,
    body: { required: true, content: { "application/json": { schema: DraftBody } } },
  },
  responses: {
    200: {
      description: "The validation issues (empty when publishable)",
      content: { "application/json": { schema: ValidateDraftResponse } },
    },
    ...errorResponses(400, 401, 404, 422),
  },
  ...withScopes("forms:write"),
});

export const publishFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/publish",
  summary: "Publish the draft: freeze a snapshot, compile A2UI, persist a version (admin)",
  tags,
  request: { params: FormIdParam },
  responses: {
    200: {
      description: "The new published version",
      content: { "application/json": { schema: PublishedResponse } },
    },
    // 409: no draft to publish. 422: publish invariants fail (PublishError[]).
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const closeFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/close",
  summary: "Close a form to new sessions; in-flight sessions finish (admin)",
  tags,
  request: { params: FormIdParam },
  responses: {
    200: {
      description: "The form's new lifecycle status",
      content: { "application/json": { schema: FormStatusResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("forms:write"),
});

export const reopenFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/reopen",
  summary: "Reopen a closed form to new sessions (admin)",
  tags,
  request: { params: FormIdParam },
  responses: {
    200: {
      description: "The form's new lifecycle status",
      content: { "application/json": { schema: FormStatusResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("forms:write"),
});

export const getFormVersionRoute = createRoute({
  method: "get",
  path: "/forms/{id}/versions/{v}",
  summary: "Read one published version's full snapshot (definition + compiled) (admin)",
  tags,
  request: { params: FormVersionParam },
  responses: {
    200: {
      description: "The frozen version snapshot",
      content: { "application/json": { schema: FormVersionSnapshotResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("forms:read"),
});

/**
 * Register every admin form route on an admin group. The admin-auth gate
 * (`registerAdminAuth`) must precede this in the admin bucket so it runs first.
 */
export const registerForms: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(createFormRoute, makeCreateFormHandler(deps));
  group.openapi(listFormsRoute, makeListFormsHandler(deps));
  group.openapi(getFormRoute, makeGetFormHandler(deps));
  group.openapi(putDraftRoute, makePutDraftHandler(deps));
  group.openapi(validateDraftRoute, makeValidateDraftHandler(deps));
  group.openapi(publishFormRoute, makePublishFormHandler(deps));
  group.openapi(closeFormRoute, makeCloseFormHandler(deps));
  group.openapi(reopenFormRoute, makeReopenFormHandler(deps));
  group.openapi(getFormVersionRoute, makeGetFormVersionHandler(deps));
};
