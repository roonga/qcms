// These are the only grant write path: the auth plugin's own team and member write
// endpoints are kept off the auth mount's allowlist. Who may call each route is
// `route-policy.ts`'s, enforced by the grant middleware before any handler here runs.

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  approveWorkspaceRequestRoute,
  listWorkspaceRequestsRoute,
  makeApproveWorkspaceRequestHandler,
  makeListWorkspaceRequestsHandler,
  makeRejectWorkspaceRequestHandler,
  rejectWorkspaceRequestRoute,
} from "./approvals.js";
import {
  makeAddHolderHandler,
  makeAgentAuditHandler,
  makeAuditHandler,
  makeCreateAccessGroupHandler,
  makeDeleteAccessGroupHandler,
  makeListAccessGroupsHandler,
  makeListMembersHandler,
  makeMyAccessHandler,
  makeReadWorkspaceSettingsHandler,
  makeReconfirmHolderHandler,
  makeRemoveHolderHandler,
  makeRemoveMemberHandler,
  makeSetMemberRoleHandler,
  makeSiteAuditHandler,
  makeUpdateAccessGroupHandler,
  makeWorkspaceSettingsHandler,
} from "./handler.js";
import {
  AccessGroupHeldResponse,
  AccessGroupHolderParams,
  AccessGroupListResponse,
  AccessGroupParams,
  AccessGroupResponse,
  AddHolderBody,
  AgentAuditListResponse,
  AgentAuditQuery,
  AuditListResponse,
  AuditQuery,
  CreateAccessGroupBody,
  MyAccessResponse,
  SetMemberRoleBody,
  SiteAuditListResponse,
  SiteAuditQuery,
  UpdateAccessGroupBody,
  WorkspaceIdParam,
  WorkspaceMemberListResponse,
  WorkspaceMemberParams,
  WorkspaceMemberResponse,
  WorkspaceSettingsBody,
  WorkspaceSettingsHeldResponse,
  WorkspaceSettingsReadResponse,
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
    "routes refuse. It is a projection and authorises nothing. `multipleWorkspaces` says " +
    "the installation holds two or more workspaces not archived, to an administrator.",
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
  summary: "Appoint or remove a Workspace administrator (admin)",
  description:
    "The Workspace administrator flag lives on the member row rather than on an access " +
    "group. Each direction writes an `administrator` audit row, and a write that leaves " +
    "the flag where it was writes none. Removing the last " +
    "active, claimed Workspace administrator is refused for every actor, a Site " +
    "administrator included: that role never satisfies the guard, and a workspace with " +
    "no administrator is one nobody can administer. The write takes the workspace's " +
    "membership lock, so two removals cannot jointly remove the last one.",
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

export const removeMemberRoute = createRoute({
  method: "delete",
  path: "/workspaces/{id}/members/{userId}",
  summary: "Take somebody out of this workspace (admin)",
  description:
    "Removes every access group the person holds here and the member row itself, one " +
    "revoke row each, in one transaction under the workspace's membership lock. The " +
    "account and every other workspace are untouched: a Workspace administrator revokes " +
    "within their own workspace and never disables an account. The last active, claimed " +
    "Workspace administrator cannot be removed. Allowed on an archived workspace, which " +
    "refuses every grant but never a revoke.",
  tags,
  request: { params: WorkspaceMemberParams },
  responses: {
    204: { description: "Removed" },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const listAccessGroupsRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/access-groups",
  summary: "The workspace's access groups, with their roles, environments and holders (admin)",
  description:
    "An access group is one grant: a set of roles and one environment set, held by the " +
    "people in it. The name is a label an administrator chose, unique within the " +
    "workspace and never parsed to authorise anything.",
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
    "The roles and the environment set are the grant and the name is a label nothing " +
    "parses to authorise. Names are unique within a workspace. The environment set is " +
    "written in the order of the environments table, so one set has one spelling. " +
    "Creating a group writes one `group` audit row; it grants nobody anything until a " +
    "holder is added, which writes a `grant` row of its own.",
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
  summary: "Rename an access group, or change its roles and environments (admin)",
  description:
    "One `group` audit row naming what the group now carries and what it carried " +
    "before. With second approval on, a change that would give the person making it, who " +
    "is in the group, a response role or a new environment for one is held as a self-grant " +
    "request, answered 202, binding the name, roles and environments it asked for. " +
    "A change that adds a response role leaves a holder's hold suspended until a different " +
    "administrator re-confirms it, where the holder's newest sign-in links are reset or " +
    "reactivation links and the person making the change performed that reset or " +
    "reactivation or is the holder; made by anybody else, it re-confirms the hold, audited " +
    "as a re-confirmation. It answers `409 ACCOUNT_BUSY` while an act on any holder's " +
    "account is in flight.",
  tags,
  request: { params: AccessGroupParams, body: jsonBody(UpdateAccessGroupBody) },
  responses: {
    200: {
      description: "The access group as it now stands",
      content: { "application/json": { schema: AccessGroupResponse } },
    },
    202: {
      description:
        "Held as a self-grant request, because second approval is on and the edit gives the " +
        "caller, who is in the group, a response role or a new environment for one. Nothing " +
        "changes until it is approved, and an approval applies the name the edit asked for " +
        "along with the roles and environments.",
      content: { "application/json": { schema: AccessGroupHeldResponse } },
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
    "per holder, beside the one `group` row that records the removal itself, in the same " +
    "transaction, which is why no removal may originate at the organisation plugin's own " +
    "endpoint: its cascade runs below any hook and would leave the removals invisible. " +
    "Allowed on an archived workspace, since removing a group is a revoke.",
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
    "the workspace. With second approval on, a self-grant of a group carrying a response " +
    "role is held as a workspace approval request bound to the group's roles and " +
    "environments, answered 202, until a different Workspace administrator or a Site " +
    "administrator approves it; with it off it is allowed and audited. " +
    "An unknown account gets one generic 404, `ACCOUNT_NOT_ADDABLE`, on both the " +
    "`email` and the `userId` path, and so does an account named by `userId` that is " +
    "not yet in this workspace unless the caller is the installation administrator: " +
    "anybody else adds a newcomer by exact address. Refused on an archived workspace. " +
    "A response grant is written suspended, until a different administrator re-confirms " +
    "it, where the account's newest sign-in links are reset or reactivation links and " +
    "the caller sent one or is the account.",
  tags,
  request: { params: AccessGroupParams, body: jsonBody(AddHolderBody) },
  responses: {
    201: {
      description: "The access group, with its holders",
      content: { "application/json": { schema: AccessGroupResponse } },
    },
    202: {
      description: "Held as a self-grant request; the group is unchanged",
      content: { "application/json": { schema: AccessGroupHeldResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const removeHolderRoute = createRoute({
  method: "delete",
  path: "/workspaces/{id}/access-groups/{teamId}/holders/{userId}",
  summary: "Revoke an access group from somebody (admin)",
  description:
    "One grant row and one access-audit revoke row, in the same transaction. Allowed on " +
    "an archived workspace, which refuses every grant but never a revoke.",
  tags,
  request: { params: AccessGroupHolderParams },
  responses: {
    204: { description: "Revoked" },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:write"),
});

export const reconfirmHolderRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/access-groups/{teamId}/holders/{userId}/reconfirm",
  summary: "Re-confirm a suspended membership (admin)",
  description:
    "Lifts the suspension a credential reset or a reactivation put on a membership of a " +
    "group carrying a response role, and writes one `grant` row. Always refused for the " +
    "membership's own subject. Refused for the person who performed the reset or " +
    "reactivation while another active, claimed administrator of this workspace, a Site " +
    "administrator included, exists; where none does, that person may re-confirm and " +
    "the row records it. Refused on an archived workspace.",
  tags,
  request: { params: AccessGroupHolderParams },
  responses: {
    200: {
      description: "The access group, with its holders",
      content: { "application/json": { schema: AccessGroupResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const workspaceSettingsRoute = createRoute({
  method: "put",
  path: "/workspaces/{id}/settings",
  summary: "The workspace's second-approval switch (admin)",
  description:
    "Off by default. It governs second approval for a production publish and a " +
    "production endpoint change, and the self-grant rule for a response role, so a " +
    "workspace turns on one thing and gets the whole posture. Turning it on is refused " +
    "where nobody else could approve: no other active Workspace administrator or Site " +
    "administrator, or fewer than two active holders of Publish forms for prod. Turning " +
    "it off while it is on is held as a workspace approval request, answered 202. Each " +
    "change writes an access-audit row of kind `setting`. Refused on an archived workspace.",
  tags,
  request: { params: WorkspaceIdParam, body: jsonBody(WorkspaceSettingsBody) },
  responses: {
    200: {
      description: "The settings as they now stand",
      content: { "application/json": { schema: WorkspaceSettingsResponse } },
    },
    202: {
      description: "Turning it off is held until another administrator approves it",
      content: { "application/json": { schema: WorkspaceSettingsHeldResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const readWorkspaceSettingsRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/settings",
  summary:
    "The workspace's second-approval switch, its appearance lock, and whether anybody else " +
    "could approve (admin)",
  description:
    "`nobodyElseCouldApprove` is read from the caller's seat: true where there is no " +
    "other active Workspace administrator or Site administrator, or fewer than two active " +
    "holders of Publish forms for prod. Unclaimed and disabled accounts never count. " +
    "`appearanceLocked` is the workspace's appearance lock, which the theme list read " +
    "carries too for a holder who is no administrator.",
  tags,
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: "The settings",
      content: { "application/json": { schema: WorkspaceSettingsReadResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:read"),
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
    "respondent identifier and no question text - the act, not its subject matter. " +
    "`actor` narrows to one account's acts, by its stored id. `actors` names the accounts " +
    "the whole audit carries, most recently active first and at most 100, whatever the " +
    "filters, so a person filter can offer them.",
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

export const siteAuditRoute = createRoute({
  method: "get",
  path: "/site-audit",
  summary: "The site audit (admin)",
  description:
    "Every account act, every Site administrator act and every change to the shared " +
    "question library, newest first. Site administrators only: a workspace " +
    "administrator reads their own workspace's audit, where a site act that affected " +
    "that workspace is mirrored. It carries no credential, no answer value and no " +
    "authored text.",
  tags,
  request: { query: SiteAuditQuery },
  responses: {
    200: {
      description: "The site audit rows",
      content: { "application/json": { schema: SiteAuditListResponse } },
    },
    ...errorResponses(400, 401, 403),
  },
  ...withScopes("forms:read"),
});

export const agentAuditRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/agent-actions",
  summary: "The agent audit for this workspace (admin)",
  description:
    "Every step an assistant proposed and a human confirmed, newest first: who confirmed " +
    "it, on which screen, in which environment, which step of which proposal, and one " +
    "non-content detail. Readable by the same people who read the access audit, the " +
    "workspace's owners and the installation administrator, because the two answer the " +
    "same question about the same workspace. It carries no answer value, no secret and no " +
    "authored text.",
  tags,
  request: { params: WorkspaceIdParam, query: AgentAuditQuery },
  responses: {
    200: {
      description: "The agent audit rows",
      content: { "application/json": { schema: AgentAuditListResponse } },
    },
    ...errorResponses(400, 401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const registerMembership: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(myAccessRoute, makeMyAccessHandler(deps));
  group.openapi(listMembersRoute, makeListMembersHandler(deps));
  group.openapi(setMemberRoleRoute, makeSetMemberRoleHandler(deps));
  group.openapi(removeMemberRoute, makeRemoveMemberHandler(deps));
  group.openapi(listAccessGroupsRoute, makeListAccessGroupsHandler(deps));
  group.openapi(createAccessGroupRoute, makeCreateAccessGroupHandler(deps));
  group.openapi(updateAccessGroupRoute, makeUpdateAccessGroupHandler(deps));
  group.openapi(deleteAccessGroupRoute, makeDeleteAccessGroupHandler(deps));
  group.openapi(addHolderRoute, makeAddHolderHandler(deps));
  group.openapi(removeHolderRoute, makeRemoveHolderHandler(deps));
  group.openapi(reconfirmHolderRoute, makeReconfirmHolderHandler(deps));
  group.openapi(workspaceSettingsRoute, makeWorkspaceSettingsHandler(deps));
  group.openapi(readWorkspaceSettingsRoute, makeReadWorkspaceSettingsHandler(deps));
  group.openapi(listWorkspaceRequestsRoute, makeListWorkspaceRequestsHandler(deps));
  group.openapi(approveWorkspaceRequestRoute, makeApproveWorkspaceRequestHandler(deps));
  group.openapi(rejectWorkspaceRequestRoute, makeRejectWorkspaceRequestHandler(deps));
  group.openapi(auditRoute, makeAuditHandler(deps));
  group.openapi(siteAuditRoute, makeSiteAuditHandler(deps));
  group.openapi(agentAuditRoute, makeAgentAuditHandler(deps));
};
