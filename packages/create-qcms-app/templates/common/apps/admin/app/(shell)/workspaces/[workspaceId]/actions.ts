"use server";

import { revalidatePath } from "next/cache";

import { t, type MessageKey } from "@/lib/i18n/en";
import type { AgentProposalRef } from "@/lib/server/agent-proposal";
import type { ApiResult } from "@/lib/server/api-result";
import { membershipRefusal } from "@/lib/membership/refusals";
import { WORKSPACE_SECTIONS, workspaceSectionHref } from "@/lib/membership/sections";
import type { MembershipActionState } from "@/lib/membership/types";
import {
  addHolder,
  approveWorkspaceRequest,
  archiveWorkspace,
  createAccessGroup,
  deleteAccessGroup,
  reconfirmHolder,
  rejectWorkspaceRequest,
  removeHolder,
  removeMember,
  renameWorkspace,
  setMemberRole,
  setWorkspaceSettings,
  updateAccessGroup,
} from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/* The API authorizes grants; hiding a control here cannot be the access boundary. */

// Every section, because one act shows on more than one: a grant adds a member row and an audit row.
function refresh(workspaceId: string): void {
  for (const section of WORKSPACE_SECTIONS) {
    revalidatePath(workspaceSectionHref(workspaceId, section));
  }
}

function refused(
  result: Extract<ApiResult<unknown>, { ok: false }>,
  wrapper: MessageKey,
): MembershipActionState {
  const outcome = membershipRefusal(result);
  return outcome.kind === "held"
    ? { status: "held", message: outcome.message }
    : { status: "error", message: t(wrapper, { message: outcome.message }) };
}

export async function createAccessGroupAction(
  workspaceId: string,
  body: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
  },
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await createAccessGroup(session, workspaceId, body, proposal);
  if (!result.ok) return refused(result, "membership.groups.createFailed");
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.groups.created", { name: result.data.name }),
    teamId: result.data.teamId,
    name: result.data.name,
  };
}

export async function updateAccessGroupAction(
  workspaceId: string,
  teamId: string,
  body: {
    readonly name: string;
    readonly roles: readonly string[];
    readonly environments: readonly string[];
  },
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await updateAccessGroup(session, workspaceId, teamId, body);
  if (!result.ok) return refused(result, "membership.groups.updateFailed");
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.groups.saved", { name: result.data.name }),
    teamId: result.data.teamId,
    name: result.data.name,
  };
}

export async function removeAccessGroupAction(
  workspaceId: string,
  teamId: string,
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await deleteAccessGroup(session, workspaceId, teamId, proposal);
  if (!result.ok) return refused(result, "membership.groups.removeFailed");
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
  if (!result.ok) return refused(result, "membership.groups.holderFailed");
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
  if (!result.ok) return refused(result, "membership.groups.holderFailed");
  refresh(workspaceId);
  return { status: "done", message: t("membership.groups.holderRemoved") };
}

export async function reconfirmHolderAction(
  workspaceId: string,
  teamId: string,
  userId: string,
  person: string,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await reconfirmHolder(session, workspaceId, teamId, userId);
  if (!result.ok) return refused(result, "membership.person.reconfirmFailed");
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.person.reconfirmed", { person, group: result.data.name }),
  };
}

export async function removeMemberAction(
  workspaceId: string,
  userId: string,
  person: string,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await removeMember(session, workspaceId, userId);
  if (!result.ok) return refused(result, "membership.person.removeFailed");
  refresh(workspaceId);
  return { status: "done", message: t("membership.person.removed", { person }), userId };
}

export async function setMemberRoleAction(
  workspaceId: string,
  userId: string,
  role: "forms.owner" | "member",
  proposal?: AgentProposalRef,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await setMemberRole(session, workspaceId, userId, role, proposal);
  if (!result.ok) return refused(result, "membership.members.roleFailed");
  refresh(workspaceId);
  return {
    status: "done",
    message:
      result.data.role === "forms.owner"
        ? t("membership.members.appointed")
        : t("membership.members.administratorRemoved"),
    userId: result.data.userId,
    role: result.data.role,
  };
}

export async function saveWorkspaceSettingsAction(
  workspaceId: string,
  next: { readonly requireSecondApprover: boolean },
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
  if (result.data.request !== undefined) {
    return { status: "held", message: t("membership.settings.held") };
  }
  return {
    status: "done",
    message: t("membership.settings.saved"),
    requireSecondApprover: result.data.requireSecondApprover,
  };
}

export async function renameWorkspaceAction(
  workspaceId: string,
  name: string,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await renameWorkspace(session, workspaceId, name);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.settings.renameFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return {
    status: "done",
    message: t("membership.settings.renamed", { name: result.data.name }),
    name: result.data.name,
  };
}

export async function archiveWorkspaceAction(workspaceId: string): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await archiveWorkspace(session, workspaceId);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.archive.failed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return { status: "done", message: t("membership.archive.archived", { name: result.data.name }) };
}

export async function decideWorkspaceRequestAction(
  workspaceId: string,
  requestId: string,
  decision: "approve" | "reject",
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result =
    decision === "approve"
      ? await approveWorkspaceRequest(session, workspaceId, requestId)
      : await rejectWorkspaceRequest(session, workspaceId, requestId);
  if (!result.ok) {
    return {
      status: "error",
      message: t(
        decision === "approve"
          ? "membership.requests.approveFailed"
          : "membership.requests.rejectFailed",
        { message: result.message },
      ),
    };
  }
  refresh(workspaceId);
  return {
    status: "done",
    message: t(
      decision === "approve" ? "membership.requests.approved" : "membership.requests.rejected",
    ),
    request: result.data,
  };
}
