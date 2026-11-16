import { z } from "zod";

import {
  AddHolderBody,
  CreateAccessGroupBody,
  SetMemberRoleBody,
  WorkspaceSettingsBody,
} from "../../membership/schema.js";
import { ACTION_DESCRIPTIONS } from "../prompts/prompts.generated.js";
import { routeArgs, stated, type StepArgs } from "./derive.js";
import type { ActionKindDef } from "./types.js";

/**
 * D8's workspace administration. The self-grant rule and the two-person rule are the
 * route's own, so a grant to the proposing account is refused there exactly as it is for a
 * press on the screen; nothing here softens either.
 */

const GROUP_PATH = "/admin/workspaces/{id}/access-groups/{teamId}";

const WorkspaceArg = z.string().min(1).max(200);
const TeamArg = z.string().min(1).max(200);
const UserArg = z.string().min(1).max(200);

const WORKSPACE_PARAM = { workspaceId: "id" } as const;
const GROUP_PARAMS = { workspaceId: "id", teamId: "teamId" } as const;

const groupCreate = routeArgs(
  CreateAccessGroupBody,
  {
    workspaceId: WorkspaceArg,
    name: CreateAccessGroupBody.shape.name.describe(
      "The group's name, unique within the workspace. It is a label, not a rule.",
    ),
    roles: CreateAccessGroupBody.shape.roles.describe(
      "Every role each holder of this group is granted.",
    ),
    environments: CreateAccessGroupBody.shape.environments.describe(
      "The environments the group applies in. There is no value meaning all of them. " +
        "Empty only where every role in the group is forms.viewer or forms.editor, which " +
        "apply in every environment.",
    ),
  } satisfies StepArgs<typeof CreateAccessGroupBody.shape, never, "workspaceId">,
  { params: WORKSPACE_PARAM },
);

const GroupArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  teamId: TeamArg,
});

const grant = routeArgs(
  AddHolderBody,
  {
    workspaceId: WorkspaceArg,
    teamId: TeamArg,
    email: stated(AddHolderBody.shape.email).describe(
      "The address of the person the group is granted to.",
    ),
  } satisfies StepArgs<typeof AddHolderBody.shape, "userId", "workspaceId" | "teamId">,
  // Exactly one of the two, and a card names the person by address: an account id is one
  // the model never has and the screen never shows.
  { unnamed: ["userId"], params: GROUP_PARAMS },
);

const RevokeArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  teamId: TeamArg,
  userId: UserArg,
});

const memberRole = routeArgs(
  SetMemberRoleBody,
  {
    workspaceId: WorkspaceArg,
    userId: UserArg,
    role: SetMemberRoleBody.shape.role.describe("The member row's new role."),
  } satisfies StepArgs<typeof SetMemberRoleBody.shape, never, "workspaceId" | "userId">,
  { params: { workspaceId: "id", userId: "userId" } },
);

const workspaceSettings = routeArgs(
  WorkspaceSettingsBody,
  {
    workspaceId: WorkspaceArg,
    requireSecondApprover: WorkspaceSettingsBody.shape.requireSecondApprover.describe(
      "Whether a production release and a response self-grant need a second account.",
    ),
  } satisfies StepArgs<typeof WorkspaceSettingsBody.shape, never, "workspaceId">,
  { params: WORKSPACE_PARAM },
);

export const createAccessGroup: ActionKindDef = {
  kind: "access.groupCreate",
  screen: "/workspaces/[workspaceId]/access-groups",
  route: { method: "POST", path: "/admin/workspaces/{id}/access-groups" },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  ...groupCreate,
  references: ["teamId"],
  resultAllowlist: ["teamId", "name"],
  card: {
    titleKey: "agent.card.access.groupCreate.title",
    consequenceKeys: ["agent.card.access.groupCreate.consequence"],
    headingControl: "membership.groupCreate",
  },
  description: ACTION_DESCRIPTIONS["access.groupCreate"],
};

export const removeAccessGroup: ActionKindDef = {
  kind: "access.groupRemove",
  screen: "/workspaces/[workspaceId]/access-groups",
  route: { method: "DELETE", path: GROUP_PATH },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  args: GroupArgs,
  recomputeArgs: (facts) => ({
    workspaceId: facts.params.id ?? "",
    teamId: facts.params.teamId ?? "",
  }),
  references: ["teamId"],
  resultAllowlist: ["teamId"],
  card: {
    titleKey: "agent.card.access.groupRemove.title",
    consequenceKeys: ["agent.card.access.groupRemove.consequence"],
    headingControl: "membership.groupRemove",
  },
  description: ACTION_DESCRIPTIONS["access.groupRemove"],
};

export const grantAccessGroup: ActionKindDef = {
  kind: "access.grant",
  screen: "/workspaces/[workspaceId]/access-groups",
  route: { method: "POST", path: `${GROUP_PATH}/holders` },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  ...grant,
  references: ["teamId"],
  resultAllowlist: ["teamId", "name"],
  card: {
    titleKey: "agent.card.access.grant.title",
    consequenceKeys: ["agent.card.access.grant.consequence"],
    headingControl: "membership.grant",
  },
  description: ACTION_DESCRIPTIONS["access.grant"],
};

export const revokeAccessGroup: ActionKindDef = {
  kind: "access.revoke",
  screen: "/workspaces/[workspaceId]/access-groups",
  route: { method: "DELETE", path: `${GROUP_PATH}/holders/{userId}` },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  args: RevokeArgs,
  recomputeArgs: (facts) => ({
    workspaceId: facts.params.id ?? "",
    teamId: facts.params.teamId ?? "",
    userId: facts.params.userId ?? "",
  }),
  references: ["userId"],
  resultAllowlist: ["teamId", "userId"],
  card: {
    titleKey: "agent.card.access.revoke.title",
    consequenceKeys: ["agent.card.access.revoke.consequence"],
    headingControl: "membership.revoke",
  },
  description: ACTION_DESCRIPTIONS["access.revoke"],
};

export const setMemberRole: ActionKindDef = {
  kind: "member.role",
  screen: "/workspaces/[workspaceId]/members",
  route: { method: "PUT", path: "/admin/workspaces/{id}/members/{userId}" },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  ...memberRole,
  references: ["userId"],
  resultAllowlist: ["userId", "role"],
  card: {
    titleKey: "agent.card.member.role.title",
    consequenceKeys: ["agent.card.member.role.consequence"],
    headingControl: "membership.memberRole",
  },
  description: ACTION_DESCRIPTIONS["member.role"],
};

export const saveWorkspaceSettings: ActionKindDef = {
  kind: "workspace.settings",
  screen: "/workspaces/[workspaceId]/settings",
  route: { method: "PUT", path: "/admin/workspaces/{id}/settings" },
  cell: { resource: "workspace", action: "update" },
  environmentFrom: "switcher",
  ...workspaceSettings,
  references: [],
  resultAllowlist: ["requireSecondApprover"],
  card: {
    titleKey: "agent.card.workspace.settings.title",
    consequenceKeys: ["agent.card.workspace.settings.consequence"],
    headingControl: "membership.workspaceSettings",
  },
  description: ACTION_DESCRIPTIONS["workspace.settings"],
};
