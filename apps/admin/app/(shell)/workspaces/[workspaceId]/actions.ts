"use server";

import { revalidatePath } from "next/cache";

import { t } from "@/lib/i18n/en";
import type { AgentProposalRef } from "@/lib/server/agent-proposal";
import { WORKSPACE_SECTIONS, workspaceSectionHref } from "@/lib/membership/sections";
import type { MembershipActionState } from "@/lib/membership/types";
import {
  addHolder,
  createAccessGroup,
  deleteAccessGroup,
  removeHolder,
  setMemberRole,
  setWorkspaceSettings,
} from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/* The API authorizes grants; hiding a control here cannot be the access boundary. */

// Every section, because one act shows on more than one: a grant adds a member row and an audit row.
function refresh(workspaceId: string): void {
  for (const section of WORKSPACE_SECTIONS) {
    revalidatePath(workspaceSectionHref(workspaceId, section));
  }
}

export async function createAccessGroupAction(
  workspaceId: string,
  body: {
    readonly name: string;
    readonly role: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
    readonly label?: string;
  },
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await createAccessGroup(session, workspaceId, body, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.groups.createFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.groups.created", { name: result.data.name }),
    teamId: result.data.teamId,
    name: result.data.name,
    role: result.data.role,
  };
}

export async function removeAccessGroupAction(
  workspaceId: string,
  teamId: string,
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await deleteAccessGroup(session, workspaceId, teamId, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.groups.removeFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return { status: "done", message: t("membership.groups.removed") };
}

export async function grantAccessGroupAction(
  workspaceId: string,
  teamId: string,
  email: string,
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await addHolder(session, workspaceId, teamId, email, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.groups.holderFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.groups.holderAdded", { email, name: result.data.name }),
    teamId: result.data.teamId,
    name: result.data.name,
  };
}

export async function revokeAccessGroupAction(
  workspaceId: string,
  teamId: string,
  userId: string,
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await removeHolder(session, workspaceId, teamId, userId, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.groups.holderFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return { status: "done", message: t("membership.groups.holderRemoved") };
}

export async function setMemberRoleAction(
  workspaceId: string,
  userId: string,
  role: "forms.owner" | "member",
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await setMemberRole(session, workspaceId, userId, role, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.members.roleFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.members.roleChanged", { role: result.data.role }),
    userId: result.data.userId,
    role: result.data.role,
  };
}

export async function saveWorkspaceSettingsAction(
  workspaceId: string,
  // Omit settings the card did not show rather than changing them to defaults nobody confirmed.
  next: {
    readonly requireSecondApprover?: boolean;
    readonly seedNewEditorsWithTestData?: boolean;
  },
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await setWorkspaceSettings(session, workspaceId, next, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.settings.saveFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.settings.saved"),
    requireSecondApprover: result.data.requireSecondApprover,
    seedNewEditorsWithTestData: result.data.seedNewEditorsWithTestData,
  };
}
