import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeCloseFormHandler,
  makeCreateFormHandler,
  makeGetFormHandler,
  makeGetFormVersionHandler,
  makeListFormsHandler,
  makePreviewConditionHandler,
  makePreviewDraftHandler,
  makePublishAndReleaseFormHandler,
  makePublishBatchHandler,
  makePublishFormHandler,
  makePutDraftHandler,
  makeReopenFormHandler,
  makeUpdateFormSettingsHandler,
  makeValidateDraftHandler,
} from "./handler.js";
import {
  CreateFormBody,
  CreatedFormResponse,
  DraftBody,
  FormDetailResponse,
  FormIdParam,
  FormSettingsResponse,
  FormEnvironmentBody,
  FormStatusResponse,
  FormVersionParam,
  FormVersionSnapshotResponse,
  ListFormsQuery,
  ListFormsResponse,
  PreviewConditionBody,
  PreviewConditionResponse,
  PreviewDraftBody,
  PreviewDraftResponse,
  PublishAndReleaseBody,
  PublishedAndReleasedResponse,
  PublishedResponse,
  SavedDraftResponse,
  UpdateFormSettingsBody,
  ValidateDraftResponse,
} from "./schema.js";
import { PublishBatchBody, ReleaseBatchResponse } from "../releases/schema.js";

const tags = ["forms"];

export const createFormRoute = createRoute({
  method: "post",
  path: "/forms",
  summary: "Create a form identity with an empty first draft (admin)",
  tags,
  request: {
    body: jsonBody(CreateFormBody),
  },
  responses: {
    201: {
      description: "The created form and its empty draft",
      content: { "application/json": { schema: CreatedFormResponse } },
    },
    ...errorResponses(400, 401, 409),
  },
  ...withScopes("forms:write"),
});

export const listFormsRoute = createRoute({
  method: "get",
  path: "/forms",
  summary:
    "List forms with draft/published status; filter by status, search slug/title, choose a sort (admin)",
  tags,
  request: { query: ListFormsQuery },
  responses: {
    200: {
      description: "The form library",
      content: { "application/json": { schema: ListFormsResponse } },
    },
    ...errorResponses(400, 401),
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
    body: jsonBody(DraftBody),
  },
  responses: {
    200: {
      description: "The saved draft and advisory validation issues",
      content: { "application/json": { schema: SavedDraftResponse } },
    },
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
    body: jsonBody(DraftBody),
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

export const previewConditionRoute = createRoute({
  method: "post",
  path: "/forms/{id}/draft/preview-condition",
  summary: "Evaluate one rule's condition against hypothetical answers (admin test bench)",
  tags,
  request: {
    params: FormIdParam,
    body: jsonBody(PreviewConditionBody),
  },
  responses: {
    200: {
      description: "The match verdict, or the typed reason it could not be reached",
      content: { "application/json": { schema: PreviewConditionResponse } },
    },
    // An unparseable draft, an unknown ruleId or unusable answers return 200 with an
    // `unavailable` outcome, not an error: the bench reads a work-in-progress draft.
    ...errorResponses(400, 401, 404, 422),
  },
  ...withScopes("forms:write"),
});

export const previewDraftRoute = createRoute({
  method: "post",
  path: "/forms/{id}/draft/preview",
  summary: "Dry-run compile of a draft plus its forward-pass projection (admin preview)",
  tags,
  request: {
    params: FormIdParam,
    body: jsonBody(PreviewDraftBody),
  },
  responses: {
    200: {
      description: "The compiled draft documents and the visible set for the given answers",
      content: { "application/json": { schema: PreviewDraftResponse } },
    },
    // 422 carries the publish issues verbatim: previewing a draft that could not be
    // published would misrepresent what a respondent would see.
    ...errorResponses(400, 401, 404, 422),
  },
  ...withScopes("forms:write"),
});

export const updateFormSettingsRoute = createRoute({
  method: "patch",
  path: "/forms/{id}/settings",
  summary: "Update the per-form abuse-control settings (admin)",
  tags,
  request: {
    params: FormIdParam,
    body: jsonBody(UpdateFormSettingsBody),
  },
  responses: {
    200: {
      description: "The settings as they now stand",
      content: { "application/json": { schema: FormSettingsResponse } },
    },
    ...errorResponses(400, 401, 404),
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
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const publishAndReleaseFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/publish-and-release",
  summary: "Publish the draft and release the new version to an environment, in one act (admin)",
  description:
    "The combined action finding 2 accepted: one intent is one act. It publishes a real, " +
    "immutable version and keeps it - there is no draft-level release and nothing skips " +
    "publishing - and the publish, the release record and the `form.released` event share " +
    "one transaction, so it happens atomically or not at all. When test and prod are served, " +
    "publish to test and promote the existing version; direct combined publication to prod is refused.",
  tags,
  request: { params: FormIdParam, body: jsonBody(PublishAndReleaseBody) },
  responses: {
    200: {
      description: "The new published version and the environment it was released to",
      content: { "application/json": { schema: PublishedAndReleasedResponse } },
    },
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const publishBatchRoute = createRoute({
  method: "post",
  path: "/forms/{id}/publish-batch",
  summary: "Freeze the draft once and release that snapshot into every destination (admin)",
  description:
    "One confirmation, one transaction, **one snapshot**: the draft is frozen once and " +
    "the same immutable version is released into each destination, never once per " +
    "target. An empty `targets` is \"create a version without releasing it\" and needs " +
    "`form: publish` alone; with destinations listed, the gate also evaluates " +
    "`release: create` once per listed environment and refuses on the first failure, " +
    "naming only that environment. `source.draftRevision` is the revision the review " +
    "reported: a save that landed in between is refused and nothing is written. The " +
    "workflow decides whether a destination accepts a version frozen in the same act, " +
    "and the two-person rule still refuses a gated production destination whose " +
    "publisher is this account, which is why that case stays two requests by two " +
    "accounts. `idempotencyKey` replays the stored result on reuse and is refused with " +
    "422 for a changed intent, so a browser timeout never creates a second version.",
  tags,
  request: { params: FormIdParam, body: jsonBody(PublishBatchBody) },
  responses: {
    200: {
      description: "The version frozen and one record per destination",
      content: { "application/json": { schema: ReleaseBatchResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const closeFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/close",
  summary: "Close one environment's intake; in-flight sessions finish (admin)",
  tags,
  request: { params: FormIdParam, body: jsonBody(FormEnvironmentBody) },
  responses: {
    200: {
      description: "The form's new lifecycle status in that environment",
      content: { "application/json": { schema: FormStatusResponse } },
    },
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const reopenFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/reopen",
  summary: "Reopen one environment's intake (admin)",
  tags,
  request: { params: FormIdParam, body: jsonBody(FormEnvironmentBody) },
  responses: {
    200: {
      description: "The form's new lifecycle status in that environment",
      content: { "application/json": { schema: FormStatusResponse } },
    },
    ...errorResponses(400, 401, 404, 409),
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

/** `registerAdminAuth` must precede this in the admin bucket so its gate runs first. */
export const registerForms: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(createFormRoute, makeCreateFormHandler(deps));
  group.openapi(listFormsRoute, makeListFormsHandler(deps));
  group.openapi(getFormRoute, makeGetFormHandler(deps));
  group.openapi(putDraftRoute, makePutDraftHandler(deps));
  group.openapi(validateDraftRoute, makeValidateDraftHandler(deps));
  group.openapi(previewConditionRoute, makePreviewConditionHandler(deps));
  group.openapi(previewDraftRoute, makePreviewDraftHandler(deps));
  group.openapi(updateFormSettingsRoute, makeUpdateFormSettingsHandler(deps));
  group.openapi(publishFormRoute, makePublishFormHandler(deps));
  group.openapi(publishAndReleaseFormRoute, makePublishAndReleaseFormHandler(deps));
  group.openapi(publishBatchRoute, makePublishBatchHandler(deps));
  group.openapi(closeFormRoute, makeCloseFormHandler(deps));
  group.openapi(reopenFormRoute, makeReopenFormHandler(deps));
  group.openapi(getFormVersionRoute, makeGetFormVersionHandler(deps));
};
