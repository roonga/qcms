import { z } from "zod";

import type { ActionKindDef, ActionRequestFacts } from "./types.js";

/**
 * D8's workspace administration. ADR-41's self-grant rule and the two-person rule are the
 * route's own, so a grant to the proposing account is refused there exactly as it is for a
 * press on the screen; nothing here softens either.
 */

const GROUP_PATH = "/admin/workspaces/{id}/access-groups/{teamId}";

const WorkspaceArg = z.string().min(1).max(200);

const CreateGroupArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "The group's name, unique within the workspace. The API refuses a name out of step " +
        'with the role, the environments and the label: it reads "<environments>.<role>" ' +
        'with ".<label>" after it when a label is given.',
    ),
  role: z.string().min(1).max(100).describe("The role every holder of this group is granted."),
  label: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe("A suffix that tells two groups of the same role and scope apart."),
  environments: z
    .array(z.string().min(1).max(53))
    .max(50)
    .describe('The environments the grant covers, or ["all"].'),
  forms: z
    .array(z.string().min(1).max(200))
    .max(200)
    .describe('The forms the grant covers, or ["all"].'),
});

const GroupArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  teamId: z.string().min(1).max(200),
});

const GrantArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  teamId: z.string().min(1).max(200),
  email: z.string().min(3).max(320).describe("The address of the person the group is granted to."),
});

const RevokeArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  teamId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
});

const MemberRoleArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  userId: z.string().min(1).max(200),
  role: z.enum(["forms.owner", "member"]).describe("The member row's new role."),
});

const WorkspaceSettingsArgs = z.strictObject({
  workspaceId: WorkspaceArg,
  requireSecondApprover: z
    .boolean()
    .optional()
    .describe("Whether a production release and a responses self-grant need a second account."),
  seedNewEditorsWithTestData: z
    .boolean()
    .optional()
    .describe("Whether a new editor is granted the dev and test response data."),
});

function bodyMember(facts: ActionRequestFacts, name: string): unknown {
  return typeof facts.body === "object" && facts.body !== null
    ? (facts.body as Record<string, unknown>)[name]
    : undefined;
}

export const createAccessGroup: ActionKindDef = {
  kind: "access.groupCreate",
  screen: "/workspaces/[workspaceId]",
  route: { method: "POST", path: "/admin/workspaces/{id}/access-groups" },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  args: CreateGroupArgs,
  recomputeArgs: (facts) => ({
    workspaceId: facts.params.id ?? "",
    name: bodyMember(facts, "name"),
    role: bodyMember(facts, "role"),
    ...(bodyMember(facts, "label") === undefined ? {} : { label: bodyMember(facts, "label") }),
    environments: bodyMember(facts, "environments"),
    forms: bodyMember(facts, "forms"),
  }),
  references: ["teamId"],
  resultAllowlist: ["teamId", "name", "role"],
  card: {
    titleKey: "agent.card.access.groupCreate.title",
    consequenceKeys: ["agent.card.access.groupCreate.consequence"],
    headingControl: "membership.groupCreate",
  },
  description:
    "Create an access group in a workspace. The group grants nobody anything until " +
    "somebody holds it, so creating one changes no access by itself.",
};

export const removeAccessGroup: ActionKindDef = {
  kind: "access.groupRemove",
  screen: "/workspaces/[workspaceId]",
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
  description:
    "Remove an access group and every grant it carried. Each holder loses that access at " +
    "once, and one revoke row is written for each.",
};

export const grantAccessGroup: ActionKindDef = {
  kind: "access.grant",
  screen: "/workspaces/[workspaceId]",
  route: { method: "POST", path: `${GROUP_PATH}/holders` },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  args: GrantArgs,
  recomputeArgs: (facts) => ({
    workspaceId: facts.params.id ?? "",
    teamId: facts.params.teamId ?? "",
    email: bodyMember(facts, "email"),
  }),
  references: ["teamId"],
  resultAllowlist: ["teamId", "name"],
  card: {
    titleKey: "agent.card.access.grant.title",
    consequenceKeys: ["agent.card.access.grant.consequence"],
    headingControl: "membership.grant",
  },
  description:
    "Grant an access group to one person, by address. A self-grant of a responses role is " +
    "refused while the workspace requires a second approver.",
};

export const revokeAccessGroup: ActionKindDef = {
  kind: "access.revoke",
  screen: "/workspaces/[workspaceId]",
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
  description: "Revoke one person's hold on an access group. Every other holder keeps theirs.",
};

export const setMemberRole: ActionKindDef = {
  kind: "member.role",
  screen: "/workspaces/[workspaceId]",
  route: { method: "PUT", path: "/admin/workspaces/{id}/members/{userId}" },
  cell: { resource: "membership", action: "write" },
  environmentFrom: "switcher",
  args: MemberRoleArgs,
  recomputeArgs: (facts) => ({
    workspaceId: facts.params.id ?? "",
    userId: facts.params.userId ?? "",
    role: bodyMember(facts, "role"),
  }),
  references: ["userId"],
  resultAllowlist: ["userId", "role"],
  card: {
    titleKey: "agent.card.member.role.title",
    consequenceKeys: ["agent.card.member.role.consequence"],
    headingControl: "membership.memberRole",
  },
  description:
    "Make a member an owner of the workspace, or take ownership away. Removing the last " +
    "owner is refused.",
};

export const saveWorkspaceSettings: ActionKindDef = {
  kind: "workspace.settings",
  screen: "/workspaces/[workspaceId]",
  route: { method: "PUT", path: "/admin/workspaces/{id}/settings" },
  cell: { resource: "workspace", action: "update" },
  environmentFrom: "switcher",
  args: WorkspaceSettingsArgs,
  recomputeArgs: (facts) => ({
    workspaceId: facts.params.id ?? "",
    ...(bodyMember(facts, "requireSecondApprover") === undefined
      ? {}
      : { requireSecondApprover: bodyMember(facts, "requireSecondApprover") }),
    ...(bodyMember(facts, "seedNewEditorsWithTestData") === undefined
      ? {}
      : { seedNewEditorsWithTestData: bodyMember(facts, "seedNewEditorsWithTestData") }),
  }),
  references: [],
  resultAllowlist: ["requireSecondApprover", "seedNewEditorsWithTestData"],
  card: {
    titleKey: "agent.card.workspace.settings.title",
    consequenceKeys: ["agent.card.workspace.settings.consequence"],
    headingControl: "membership.workspaceSettings",
  },
  description:
    "Change the workspace's two switches: whether a production release and a responses " +
    "self-grant need a second account, and whether a new editor is seeded with the dev " +
    "and test response data.",
};
