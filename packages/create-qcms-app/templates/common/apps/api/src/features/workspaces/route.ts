/**
 * Route definitions for the workspace model (ADR-41, task 068).
 *
 * Six routes on the **admin** surface, behind the SEC-4 internal-service-token gate and
 * the admin-session gate like every other admin slice: the workspace list, the one path
 * by which a workspace comes into existence, the shared-library switch, the archive, and
 * the two ownership moves.
 *
 * # Why the two move routes live in this slice
 *
 * `POST /forms/{id}/workspace` and `POST /questions/{id}/workspace` are addressed under
 * the form and question collections and are registered here, because what they change is
 * ownership and because they share this slice's rules: the same "the target workspace
 * exists and is not archived" check, and the same reason for existing - archiving is the
 * last step, so a workspace's contents are reassigned first (Q15). Keeping them beside
 * the archive refusal that demands them is what stops the two drifting apart. The paths
 * are distinct from every route the forms and questions slices mount, so the mount order
 * in `registrars.ts` decides nothing here.
 *
 * # Scopes
 *
 * The forms pair rather than a new `workspaces:*` member of the SEC-5 taxonomy, which is
 * fixed (`openapi.ts`). A workspace owns forms and questions and the acts below are acts
 * on the authoring plane; the authority that will actually gate them is ADR-41's
 * `forms.owner`, which task 069 builds. Scopes stay inert at launch either way.
 */

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
    // 409: the slug is taken.
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
    // 409: another workspace already holds the library, or this one is archived.
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const archiveWorkspaceRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/archive",
  summary: "Archive a workspace (admin)",
  description:
    "Refused while the workspace holds an open form or a released version, naming the " +
    "forms to reassign. Nothing is deleted, closed or moved on the operator's behalf, " +
    "and no response row is reached.",
  tags,
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: "The archived workspace",
      content: { "application/json": { schema: WorkspaceResponse } },
    },
    // 409: an open form or a released version remains, or it is archived already.
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
