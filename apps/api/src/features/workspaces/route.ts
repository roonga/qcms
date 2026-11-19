import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import { HeldResponse } from "../site-admins/schema.js";
import {
  makeArchiveWorkspaceHandler,
  makeCreateWorkspaceHandler,
  makeListWorkspacesHandler,
  makeMoveFormHandler,
  makeMoveFormPreviewHandler,
  makeRenameWorkspaceHandler,
  makeSetSharedWorkspaceHandler,
} from "./handler.js";
import {
  makeCreateWorkspaceThemeHandler,
  makeDeleteWorkspaceThemeHandler,
  makeGetWorkspaceThemeHandler,
  makeListWorkspaceThemesHandler,
  makeSetAppearanceLockHandler,
  makeUpdateWorkspaceThemeHandler,
  makeUploadThemeLogoHandler,
} from "./themes.js";
import {
  AppearanceLockBody,
  AppearanceLockResponse,
  CreateWorkspaceBody,
  MovePreviewQuery,
  MovePreviewResponse,
  MoveToWorkspaceBody,
  MovedResponse,
  RenameWorkspaceBody,
  SharedWorkspaceBody,
  ThemeIdParam,
  ThemeLogoBody,
  ThemeLogoResponse,
  WorkspaceIdParam,
  WorkspaceListResponse,
  WorkspaceResponse,
  WorkspaceThemeBody,
  WorkspaceThemeListResponse,
  WorkspaceThemeResponse,
} from "./schema.js";

const tags = ["workspaces"];

export const listWorkspacesRoute = createRoute({
  method: "get",
  path: "/workspaces",
  summary: "The caller's workspaces, with what each owns (admin)",
  description:
    "Only the workspaces the caller administers; the installation administrator gets " +
    "every one. Oldest first, archived workspaces included: a workspace is archived and " +
    "never deleted, and one that still owns questions is what a reader needs to see.",
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
  summary: "Create a workspace (Site administrator)",
  description:
    "Site administrator only. Names the first Workspace administrator by address, the " +
    "caller when absent; that account must exist. Creates the workspace, that membership " +
    "and the four starter groups (Authors, Publishers, Response viewers, Response erasers) " +
    "in one transaction, with one audit row. Slugs are unique site-wide.",
  tags,
  request: { body: jsonBody(CreateWorkspaceBody) },
  responses: {
    201: {
      description: "The workspace just created",
      content: { "application/json": { schema: WorkspaceResponse } },
    },
    ...errorResponses(400, 401, 403, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const renameWorkspaceRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/name",
  summary: "Rename a workspace (admin)",
  description:
    "Changes the name only; the slug never changes. One audit row records the old and " +
    "the new name. Refused on an archived workspace, and for anyone who is not an " +
    "administrator of that workspace or the installation administrator.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(RenameWorkspaceBody) },
  responses: {
    200: {
      description: "The workspace as it now stands",
      content: { "application/json": { schema: WorkspaceResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
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
    "the shared library. It writes one `setting` audit row, the kind a rename and the " +
    "second-approval switch are written with.",
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

const themeTags = ["workspaces"];

const themeAuthority =
  "Edit forms in that workspace. A Workspace administrator or a Site administrator who " +
  "holds no Edit forms grant there is refused, because theming is authoring and not " +
  "administration (docs/WORKSPACE_ACCESS.md section 3).";

export const listWorkspaceThemesRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/themes",
  summary: "A workspace's named themes (Edit forms)",
  description: themeAuthority,
  tags: themeTags,
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: "The workspace's themes, by name",
      content: { "application/json": { schema: WorkspaceThemeListResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const getWorkspaceThemeRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/themes/{themeId}",
  summary: "One workspace theme (Edit forms)",
  description: themeAuthority,
  tags: themeTags,
  request: { params: ThemeIdParam },
  responses: {
    200: {
      description: "The theme",
      content: { "application/json": { schema: WorkspaceThemeResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const createWorkspaceThemeRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/themes",
  summary: "Save a workspace theme (Edit forms)",
  description:
    `${themeAuthority} The palettes go through the shared appearance schema and the WCAG ` +
    "contrast check; a failing set is refused with the correction report. Nothing links a " +
    "form to a theme: applying one copies its values into a draft.",
  tags: themeTags,
  request: { params: WorkspaceIdParam, body: jsonBody(WorkspaceThemeBody) },
  responses: {
    201: {
      description: "The theme just saved",
      content: { "application/json": { schema: WorkspaceThemeResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const updateWorkspaceThemeRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/themes/{themeId}",
  summary: "Change a workspace theme (Edit forms)",
  description:
    `${themeAuthority} Replaces every stored field. No draft and no version changes: each ` +
    "carries the appearance it copied (docs/WORKSPACE_ACCESS.md section 9).",
  tags: themeTags,
  request: { params: ThemeIdParam, body: jsonBody(WorkspaceThemeBody) },
  responses: {
    200: {
      description: "The theme as it now stands",
      content: { "application/json": { schema: WorkspaceThemeResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409, 422),
  },
  ...withScopes("forms:write"),
});

export const deleteWorkspaceThemeRoute = createRoute({
  method: "delete",
  path: "/workspaces/{id}/themes/{themeId}",
  summary: "Delete a workspace theme (Edit forms)",
  description:
    `${themeAuthority} Removes the theme row and no logo, so every draft and version that ` +
    "copied this theme keeps its image. Only a Site administrator takedown removes a logo.",
  tags: themeTags,
  request: { params: ThemeIdParam },
  responses: {
    204: { description: "The theme is gone" },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:write"),
});

export const uploadThemeLogoRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/themes/{themeId}/logo",
  summary: "Upload a theme's logo (Edit forms)",
  description:
    `${themeAuthority} A non-interlaced PNG or a JPEG, confirmed by magic-number sniff, ` +
    "capped at 512 KiB and 4,194,304 pixels, then decoded and re-encoded as PNG; WebP, SVG " +
    "and anything else is refused. The re-encoded bytes are stored immutably under their " +
    "SHA-256, which is the key the logo route serves them by. An image a " +
    "Site administrator took down is refused with `LOGO_TAKEN_DOWN` (409).",
  tags: themeTags,
  request: { params: ThemeIdParam, body: jsonBody(ThemeLogoBody) },
  responses: {
    201: {
      description: "The stored logo's key",
      content: { "application/json": { schema: ThemeLogoResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409, 413, 422),
  },
  ...withScopes("forms:write"),
});

export const setAppearanceLockRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/appearance-lock",
  summary: "Set or clear the workspace appearance lock (admin)",
  description:
    "A Workspace administrator of that workspace or a Site administrator. No second " +
    "approver, even with the rule on, and exactly one `setting` row in the workspace " +
    "audit. While it is set, every draft save that would change a form's appearance is " +
    "refused, for every actor and for the assistant; a save that changes no appearance " +
    "succeeds, and a form moved in keeps what it carries.",
  tags: themeTags,
  request: { params: WorkspaceIdParam, body: jsonBody(AppearanceLockBody) },
  responses: {
    200: {
      description: "The lock as it now stands",
      content: { "application/json": { schema: AppearanceLockResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const moveFormRoute = createRoute({
  method: "post",
  path: "/forms/{id}/workspace",
  summary: "Move a form to another workspace (admin)",
  description:
    "Edit forms in the source and in the destination. One update on the identity row: no " +
    "published version changes hands and the slug does not move, so no public address " +
    "changes, and the form's responses move with it. Applied at once for an active " +
    "Workspace administrator of the source with second approval off there; every other " +
    "move, and every move at all while the rule is on, answers 202 with a held workspace " +
    "approval request, approved in the source by a Workspace administrator of it or a Site " +
    "administrator who is not the mover. Refused when the destination is archived.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(MoveToWorkspaceBody) },
  responses: {
    200: {
      description: "The form and the workspace that owns it now",
      content: { "application/json": { schema: MovedResponse } },
    },
    202: {
      description: "Held for an approver; nothing has moved",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const moveFormPreviewRoute = createRoute({
  method: "get",
  path: "/forms/{id}/workspace/preview",
  summary: "Who gains and who loses access when a form moves (admin)",
  description:
    "The same cells the policy evaluator decides every screen act by, read against the " +
    "source's groups and then the destination's, and whether the move needs an approver. " +
    "Only the two workspaces' own members are considered, so nobody outside them is named.",
  tags,
  request: { params: WorkspaceIdParam, query: MovePreviewQuery },
  responses: {
    200: {
      description: "Who gains, who loses, and whether an approver is needed",
      content: { "application/json": { schema: MovePreviewResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:read"),
});

export const registerWorkspaces: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(listWorkspacesRoute, makeListWorkspacesHandler(deps));
  group.openapi(createWorkspaceRoute, makeCreateWorkspaceHandler(deps));
  group.openapi(renameWorkspaceRoute, makeRenameWorkspaceHandler(deps));
  group.openapi(setSharedWorkspaceRoute, makeSetSharedWorkspaceHandler(deps));
  group.openapi(archiveWorkspaceRoute, makeArchiveWorkspaceHandler(deps));
  group.openapi(moveFormRoute, makeMoveFormHandler(deps));
  group.openapi(moveFormPreviewRoute, makeMoveFormPreviewHandler(deps));
  group.openapi(listWorkspaceThemesRoute, makeListWorkspaceThemesHandler(deps));
  group.openapi(createWorkspaceThemeRoute, makeCreateWorkspaceThemeHandler(deps));
  group.openapi(getWorkspaceThemeRoute, makeGetWorkspaceThemeHandler(deps));
  group.openapi(updateWorkspaceThemeRoute, makeUpdateWorkspaceThemeHandler(deps));
  group.openapi(deleteWorkspaceThemeRoute, makeDeleteWorkspaceThemeHandler(deps));
  group.openapi(uploadThemeLogoRoute, makeUploadThemeLogoHandler(deps));
  group.openapi(setAppearanceLockRoute, makeSetAppearanceLockHandler(deps));
};
