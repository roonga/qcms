"use server";

import { revalidatePath } from "next/cache";

import { t } from "@/lib/i18n/en";
import { ALL_WORKSPACES_PATH } from "@/lib/membership/sections";
import { demoteAccount, promoteAccount, stepUp, type ActOutcome } from "@/lib/server/accounts";
import type { ApiResult } from "@/lib/server/api-result";
import { approveWorkspaceRequest, rejectWorkspaceRequest } from "@/lib/server/membership";
import { requireAdminSession, type AdminSession } from "@/lib/server/session";
import { createWorkspace, decideSiteRequest, readStarterGroups } from "@/lib/server/site-admin";
import { accountErrorMessage, ACCOUNTS_PATH } from "@/lib/site/accounts";
import { SITE_ADMINISTRATORS_PATH, type RoleActState } from "@/lib/site/administrators";
import { APPROVAL_REQUESTS_PATH, decisionErrorMessage } from "@/lib/site/approvals";
import { SITE_AUDIT_PATH } from "@/lib/site/audit";
import {
  createWorkspaceErrorMessage,
  slugCandidates,
  type CreateWorkspaceState,
} from "@/lib/site/workspaces";

/* The API authorizes every act; a hidden or disabled control here is never the boundary. */

export interface StepUpCredentials {
  readonly password: string;
  readonly code: string;
}

function refused(code: string, message = accountErrorMessage(code)): RoleActState {
  return { status: "error", code, message };
}

/** A failed step-up returns before the act is sent, so nothing is requested or applied. */
async function stepUpRefusal(
  session: AdminSession,
  credentials: StepUpCredentials,
): Promise<RoleActState | undefined> {
  const result = await stepUp(session, credentials);
  return result.ok ? undefined : refused(result.code);
}

function refreshSite(): void {
  revalidatePath(SITE_ADMINISTRATORS_PATH);
  revalidatePath(APPROVAL_REQUESTS_PATH);
  revalidatePath(SITE_AUDIT_PATH);
  revalidatePath(ACCOUNTS_PATH);
}

function settled(result: ApiResult<ActOutcome>, done: string): RoleActState {
  if (!result.ok) return refused(result.code);
  refreshSite();
  if (result.data.held) return { status: "held", message: t("site.accounts.act.held") };
  return { status: "done", message: done };
}

export async function promoteAction(
  userId: string,
  credentials: StepUpCredentials,
): Promise<RoleActState> {
  const session = await requireAdminSession();
  const refusal = await stepUpRefusal(session, credentials);
  if (refusal !== undefined) return refusal;
  return settled(await promoteAccount(session, userId), t("site.administrators.promote.done"));
}

export async function demoteAction(
  userId: string,
  credentials: StepUpCredentials,
): Promise<RoleActState> {
  const session = await requireAdminSession();
  const refusal = await stepUpRefusal(session, credentials);
  if (refusal !== undefined) return refusal;
  return settled(await demoteAccount(session, userId), t("site.administrators.demote.done"));
}

function isDecision(value: unknown): value is "approve" | "reject" {
  return value === "approve" || value === "reject";
}

/** Approving a site request takes a step-up; rejecting one does not. */
export async function decideSiteRequestAction(
  requestId: string,
  decision: "approve" | "reject",
  credentials?: StepUpCredentials,
): Promise<RoleActState> {
  const session = await requireAdminSession();
  // A Server Action argument is whatever the caller posts, whatever its type says.
  if (!isDecision(decision)) return refused("http_400", decisionErrorMessage("http_400"));
  if (decision === "approve") {
    if (credentials === undefined) return refused("STEP_UP_REQUIRED");
    const refusal = await stepUpRefusal(session, credentials);
    if (refusal !== undefined) return refusal;
  }
  const result = await decideSiteRequest(session, requestId, decision);
  if (!result.ok) return refused(result.code, decisionErrorMessage(result.code));
  refreshSite();
  return {
    status: "done",
    message:
      decision === "approve"
        ? t("membership.requests.approved")
        : t("membership.requests.rejected"),
  };
}

/** A workspace request is decided through its workspace's own route, as on that workspace's Audit screen. */
export async function decideWorkspaceRequestAction(
  workspaceId: string,
  requestId: string,
  decision: "approve" | "reject",
): Promise<RoleActState> {
  const session = await requireAdminSession();
  const result =
    decision === "approve"
      ? await approveWorkspaceRequest(session, workspaceId, requestId)
      : await rejectWorkspaceRequest(session, workspaceId, requestId);
  if (!result.ok) return refused(result.code, decisionErrorMessage(result.code));
  refreshSite();
  revalidatePath(`/workspaces/${encodeURIComponent(workspaceId)}`, "layout");
  return {
    status: "done",
    message:
      decision === "approve"
        ? t("membership.requests.approved")
        : t("membership.requests.rejected"),
  };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function createWorkspaceAction(
  _state: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const session = await requireAdminSession();
  const name = field(formData, "name");
  const firstAdministrator = field(formData, "firstAdministrator");
  const fail = (code: string): CreateWorkspaceState => ({
    status: "error",
    code,
    message: createWorkspaceErrorMessage(code),
    submitted: { name, firstAdministrator },
  });
  if (name === "") return fail("http_400");

  // The stored identifier is derived, so a taken one moves on to the next candidate.
  for (const slug of slugCandidates(name)) {
    const result = await createWorkspace(session, {
      name,
      slug,
      ...(firstAdministrator === "" ? {} : { firstAdministratorEmail: firstAdministrator }),
    });
    if (!result.ok) {
      if (result.code === "WORKSPACE_SLUG_TAKEN") continue;
      return fail(result.code);
    }
    revalidatePath(ALL_WORKSPACES_PATH);
    revalidatePath("/", "layout");
    const groups = await readStarterGroups(session, result.data.workspaceId);
    return {
      status: "created",
      workspaceId: result.data.workspaceId,
      name: result.data.name,
      groups: groups.ok ? groups.data : undefined,
    };
  }
  return fail("WORKSPACE_SLUG_TAKEN");
}
