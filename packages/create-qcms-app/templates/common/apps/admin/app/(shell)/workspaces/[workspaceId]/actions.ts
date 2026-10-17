"use server";

import { revalidatePath } from "next/cache";

import { t } from "@/lib/i18n/en";
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

/**
 * The membership mutations (ADR-41, task 069; R2).
 *
 * Each one proxies to the QCMS endpoint that owns the act and reports what came back.
 * **Nothing here decides whether a grant is allowed**: the API's grant middleware is the
 * authority, a refusal arrives as a 403, and this app renders it. That is the SEC-3
 * property criterion 10 is about - a screen that forgot to hide a control still cannot
 * perform the act, because the control is not where the check lives.
 *
 * Two refusals are worth reading rather than treating as generic failures, and the catalog
 * has a sentence for each: the **self-grant** refused while the workspace requires a
 * second approver (a second owner, or the installation administrator, has to make that
 * grant), and a **duplicate name** in one workspace (names are unique per workspace, and
 * the same name in another is fine).
 *
 * `requireAdminSession()` is called in each exported function: a `"use server"` module is
 * reached directly and the shell layout's gate does not cover it (#177).
 */

/** Refresh both panels after a write: the groups list and the audit are both stale. */
function refresh(workspaceId: string): void {
  revalidatePath(`/workspaces/${workspaceId}`);
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
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await createAccessGroup(session, workspaceId, body);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.groups.createFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  // The confirmation says the group grants nobody anything yet, because team membership
  // is the grant: a reader who stopped here would otherwise believe they had granted
  // something.
  return { status: "done", message: t("membership.groups.created", { name: result.data.name }) };
}

export async function removeAccessGroupAction(
  workspaceId: string,
  teamId: string,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await deleteAccessGroup(session, workspaceId, teamId);
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
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await addHolder(session, workspaceId, teamId, email);
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
  };
}

export async function revokeAccessGroupAction(
  workspaceId: string,
  teamId: string,
  userId: string,
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await removeHolder(session, workspaceId, teamId, userId);
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
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await setMemberRole(session, workspaceId, userId, role);
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
  };
}

export async function saveWorkspaceSettingsAction(
  workspaceId: string,
  next: {
    readonly requireSecondApprover: boolean;
    readonly seedNewEditorsWithTestData: boolean;
  },
): Promise<MembershipActionState> {
  const session = await requireAdminSession();
  const result = await setWorkspaceSettings(session, workspaceId, next);
  if (!result.ok) {
    return {
      status: "error",
      message: t("membership.settings.saveFailed", { message: result.message }),
    };
  }
  refresh(workspaceId);
  return { status: "done", message: t("membership.settings.saved") };
}
