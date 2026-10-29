// These are the only grant write path: the auth plugin's own team and member write
// endpoints are kept off the auth mount's allowlist. Who may call each route is
// `route-policy.ts`'s, enforced by the grant middleware before any handler here runs.

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeAddHolderHandler,
  makeAuditHandler,
  makeCreateAccessGroupHandler,
  makeDeleteAccessGroupHandler,
  makeListAccessGroupsHandler,
  makeListMembersHandler,
  makeMyAccessHandler,
  makeRemoveHolderHandler,
  makeSetMemberRoleHandler,
  makeUpdateAccessGroupHandler,
  makeWorkspaceSettingsHandler,
} from "./handler.js";
import {
  AccessGroupHolderParams,
  AccessGroupListResponse,
  AccessGroupParams,
  AccessGroupResponse,
  AddHolderBody,
  AuditListResponse,
  AuditQuery,
  CreateAccessGroupBody,
  MyAccessResponse,
  SetMemberRoleBody,
  UpdateAccessGroupBody,
  WorkspaceIdParam,
  WorkspaceMemberListResponse,
  WorkspaceMemberParams,
  WorkspaceMemberResponse,
  WorkspaceSettingsBody,
  WorkspaceSettingsResponse,
} from "./schema.js";

const tags = ["membership"];

export const myAccessRoute = createRoute({
  method: "get",
  path: "/me/access",
  summary: "Which workspaces, roles, environments and forms the caller holds (admin)",
  description:
    "Every caller's own grants and nobody else's. It is how everybody who is not an " +
    "owner or the installation administrator learns what they hold, since the " +
    "membership list itself is theirs alone to see. `environments` per workspace is " +
    "what the environment switcher offers: only the environments the caller holds in " +
    "some grant, with `all` expanded against the live set. `capabilities` says which " +
    "areas of the admin the caller has at all, derived from the same policy decision " +
    "that gates each area's routes, so a navigation contract cannot offer a mode whose " +
    "routes refuse. It is a projection and authorises nothing.",
  tags,
  request: {},
  responses: {
    200: {
      description: "The caller's grants",
      content: { "application/json": { schema: MyAccessResponse } },
    },
    ...errorResponses(401),
  },
  ...withScopes("forms:read"),
});

export const listMembersRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/members",
  summary: "The workspace's membership list and the groups each member holds (admin)",
  description:
    "Readable by the workspace's owners and by the installation administrator, and by " +
    "nobody else: in a deployment where departments share an installation the " +
    "membership list is itself information about another department. Everybody else " +
    "reads their own grants at GET /admin/me/access.",
  tags,
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: "The members and their grants",
      content: { "application/json": { schema: WorkspaceMemberListResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const setMemberRoleRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/members/{userId}",
  summary: "Make somebody a workspace owner, or take the role away (admin)",
  description:
    "`forms.owner` is the one role that lives on the member row rather than on an " +
    "access group. Both directions write an access-audit row. The workspace's last " +
    "owner cannot be demoted, because a workspace with no owner is one nobody can " +
    "administer.",
  tags,
  request: { params: WorkspaceMemberParams, body: jsonBody(SetMemberRoleBody) },
  responses: {
    200: {
      description: "The member row as it now stands",
      content: { "application/json": { schema: WorkspaceMemberResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const listAccessGroupsRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/access-groups",
  summary: "The workspace's access groups, with their scope and their holders (admin)",
  description:
    "An access group is one grant: a role and its scope. The stored name is shown " +
    "inside a workspace page and the derived full name in cross-workspace lists; " +
    "neither derived name is stored, so renaming a workspace slug changes display only.",
  tags,
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: "The access groups",
      content: { "application/json": { schema: AccessGroupListResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const createAccessGroupRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/access-groups",
  summary: "Create an access group (admin)",
  description:
    "The role and the scope are the grant and the name is a label kept in step with " +
    "them: a name out of step with the fields is refused on save, and nothing parses a " +
    "name to authorise. Names are unique within a workspace. A combined environment " +
    "set is written in the order of the environments table, so `dev-test` is the one " +
    "spelling. A group with no holders grants nobody anything, so creating one writes " +
    "no audit row; adding a holder does.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(CreateAccessGroupBody) },
  responses: {
    201: {
      description: "The access group just created",
      content: { "application/json": { schema: AccessGroupResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const updateAccessGroupRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/access-groups/{teamId}",
  summary: "Rename or re-scope an access group (admin)",
  description:
    "The role is not changeable: a different role is a different grant, and moving one " +
    "would change what the group grants under the people holding it. Delete the group " +
    "and create the one you meant, which is two audited acts rather than one unaudited " +
    "change of meaning. A re-scope writes one audit row per holder.",
  tags,
  request: { params: AccessGroupParams, body: jsonBody(UpdateAccessGroupBody) },
  responses: {
    200: {
      description: "The access group as it now stands",
      content: { "application/json": { schema: AccessGroupResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const deleteAccessGroupRoute = createRoute({
  method: "delete",
  path: "/workspaces/{id}/access-groups/{teamId}",
  summary: "Remove an access group and every grant it carried (admin)",
  description:
    "The holders' rows go with it. They are read first and one revoke row is written " +
    "per holder, in the same transaction as the removal, which is why no removal may " +
    "originate at the organisation plugin's own endpoint: its cascade runs below any " +
    "hook and would leave the removals invisible.",
  tags,
  request: { params: AccessGroupParams },
  responses: {
    204: { description: "Removed" },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:write"),
});

export const addHolderRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/access-groups/{teamId}/holders",
  summary: "Grant an access group to somebody (admin)",
  description:
    "Team membership is the grant, so this is where a grant is written. The holder " +
    "gets a workspace member row carrying the empty role if they have none, because " +
    "the organisation plugin's own team queries assume a team member is a member of " +
    "the workspace. A self-grant of a responses role is refused while the workspace " +
    "requires a second approver, and then a second owner or the installation " +
    "administrator makes the grant; with that switch off it is allowed and audited.",
  tags,
  request: { params: AccessGroupParams, body: jsonBody(AddHolderBody) },
  responses: {
    201: {
      description: "The access group, with its holders",
      content: { "application/json": { schema: AccessGroupResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const removeHolderRoute = createRoute({
  method: "delete",
  path: "/workspaces/{id}/access-groups/{teamId}/holders/{userId}",
  summary: "Revoke an access group from somebody (admin)",
  description: "One grant row and one access-audit revoke row, in the same transaction.",
  tags,
  request: { params: AccessGroupHolderParams },
  responses: {
    204: { description: "Revoked" },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:write"),
});

export const workspaceSettingsRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/settings",
  summary: "The workspace's two switches: the second approver and the test-data seed (admin)",
  description:
    "Both default off. The second-approver switch governs the two-person rule for a " +
    "production release and a production endpoint change, and the self-grant rule for " +
    "a responses role, so an installation turns on one thing and gets the whole " +
    "two-person posture. The seed switch decides whether a new editor is also granted " +
    "a responses viewer role on dev and test, and a grant on test responses is a grant " +
    "on personal data, because a test run can involve real respondents. Turning either " +
    "on or off writes an access-audit row of kind `setting`.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(WorkspaceSettingsBody) },
  responses: {
    200: {
      description: "The settings as they now stand",
      content: { "application/json": { schema: WorkspaceSettingsResponse } },
    },
    ...errorResponses(400, 401, 403, 404),
  },
  ...withScopes("forms:write"),
});

export const auditRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/audit",
  summary: "The access audit for this workspace (admin)",
  description:
    "Every response read, export and erasure, every grant and revoke, and every change " +
    "to the seed setting, newest first. Readable by the workspace's owners and by the " +
    "installation administrator: an audit only the operator can see does not answer a " +
    "department's own question about its own data. It carries no answer value, no " +
    "respondent identifier and no question text - the act, not its subject matter.",
  tags,
  request: { params: WorkspaceIdParam, query: AuditQuery },
  responses: {
    200: {
      description: "The audit rows",
      content: { "application/json": { schema: AuditListResponse } },
    },
    ...errorResponses(400, 401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const registerMembership: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(myAccessRoute, makeMyAccessHandler(deps));
  group.openapi(listMembersRoute, makeListMembersHandler(deps));
  group.openapi(setMemberRoleRoute, makeSetMemberRoleHandler(deps));
  group.openapi(listAccessGroupsRoute, makeListAccessGroupsHandler(deps));
  group.openapi(createAccessGroupRoute, makeCreateAccessGroupHandler(deps));
  group.openapi(updateAccessGroupRoute, makeUpdateAccessGroupHandler(deps));
  group.openapi(deleteAccessGroupRoute, makeDeleteAccessGroupHandler(deps));
  group.openapi(addHolderRoute, makeAddHolderHandler(deps));
  group.openapi(removeHolderRoute, makeRemoveHolderHandler(deps));
  group.openapi(workspaceSettingsRoute, makeWorkspaceSettingsHandler(deps));
  group.openapi(auditRoute, makeAuditHandler(deps));
};
