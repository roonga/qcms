import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeArchiveWorkspaceHandler,
  makeCreateWorkspaceHandler,
  makeListWorkspacesHandler,
  makeMoveFormHandler,
  makeMoveQuestionHandler,
  makeSetSharedWorkspaceHandler,
} from "./handler.js";
import {
  CreateWorkspaceBody,
  MoveToWorkspaceBody,
  MovedResponse,
  SharedWorkspaceBody,
  WorkspaceIdParam,
  WorkspaceListResponse,
  WorkspaceResponse,
} from "./schema.js";

const tags = ["workspaces"];

export const listWorkspacesRoute = createRoute({
  method: "get",
  path: "/workspaces",
  summary: "Every workspace, with what it owns (admin)",
  description:
    "Oldest first, archived workspaces included: a workspace is archived and never " +
    "deleted, and one that still owns questions is what a reader needs to see.",
  tags,
  request: {},
  responses: {
    200: {
      description: "The installation's workspaces",
      content: { "application/json": { schema: WorkspaceListResponse } },
    },
    ...errorResponses(401),
  },
  ...withScopes("forms:read"),
});

export const createWorkspaceRoute = createRoute({
  method: "post",
  path: "/workspaces",
  summary: "Create a workspace (admin)",
  description:
    "The account making the request becomes the workspace's owner. Slugs are unique " +
    "installation-wide.",
  tags,
  request: { body: jsonBody(CreateWorkspaceBody) },
  responses: {
    201: {
      description: "The workspace just created",
      content: { "application/json": { schema: WorkspaceResponse } },
    },
    ...errorResponses(400, 401, 409),
  },
  ...withScopes("forms:write"),
});

export const setSharedWorkspaceRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/shared",
  summary: "Mark a workspace as the installation's shared question library, or unmark it (admin)",
  description:
    "At most one workspace is shared. Every workspace's editors may pin a shared " +
    "question; only the shared workspace's own members may edit one.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(SharedWorkspaceBody) },
  responses: {
    200: {
      description: "The workspace as it now stands",
      content: { "application/json": { schema: WorkspaceResponse } },
    },
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const archiveWorkspaceRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/archive",
  summary: "Archive a workspace (admin)",
  description:
    "Refused while the workspace owns any form at all, closed and never-released ones " +
    "included, or while it is the shared question library. The refusal names the forms " +
    "to reassign, reports the open and the released ones separately, and says to unmark " +
    "the library or hand it on. Nothing is deleted, closed, moved or unmarked on the " +
    "operator's behalf, and no response row is reached. An archive is terminal: there " +
    "is no unarchive, and the only write an archived workspace still takes is unmarking " +
    "the shared library.",
  tags,
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: "The archived workspace",
      content: { "application/json": { schema: WorkspaceResponse } },
    },
    ...errorResponses(401, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const moveFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/workspace",
  summary: "Move a form to another workspace (admin)",
  description:
    "One update on the identity row: no published version changes hands and the slug " +
    "does not move, so no public address changes.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(MoveToWorkspaceBody) },
  responses: {
    200: {
      description: "The form and the workspace that owns it now",
      content: { "application/json": { schema: MovedResponse } },
    },
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const moveQuestionRoute = createRoute({
  method: "post",
  path: "/questions/{id}/workspace",
  summary: "Move a question to another workspace (admin)",
  description:
    "One update on the identity row, touching no version: a form elsewhere that already " +
    "pins one of its versions keeps serving it and keeps that pin in its next draft, " +
    "while a new pin from another workspace is refused at publish.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(MoveToWorkspaceBody) },
  responses: {
    200: {
      description: "The question and the workspace that owns it now",
      content: { "application/json": { schema: MovedResponse } },
    },
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("questions:write"),
});

export const registerWorkspaces: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(listWorkspacesRoute, makeListWorkspacesHandler(deps));
  group.openapi(createWorkspaceRoute, makeCreateWorkspaceHandler(deps));
  group.openapi(setSharedWorkspaceRoute, makeSetSharedWorkspaceHandler(deps));
  group.openapi(archiveWorkspaceRoute, makeArchiveWorkspaceHandler(deps));
  group.openapi(moveFormRoute, makeMoveFormHandler(deps));
  group.openapi(moveQuestionRoute, makeMoveQuestionHandler(deps));
};
