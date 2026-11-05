"use server";

import { revalidatePath } from "next/cache";

import type { ErasureReason } from "@/lib/ops/erasure";
import { isErasureReason } from "@/lib/ops/erasure";
import type { KnownTargetLookup } from "@/lib/ops/known-target";
import type { EraseOutcome } from "@/lib/ops/types";
import { t } from "@/lib/i18n/en";
import { confirmShownEnvironment } from "@/lib/server/environments";
import type { AgentProposalRef } from "@/lib/server/agent-proposal";
import { eraseSession, erasureScope, unflagResponse } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

/* Bind the route form and displayed environment; an erasure must refuse after another tab changes the
   selection. */

export interface EraseState {
  readonly status: "erased" | "error";
  readonly data?: EraseOutcome;
  readonly message?: string;
}

export interface UnflagState {
  readonly status: "unflagged" | "error";
  readonly released?: boolean;
  readonly message?: string;
}

export async function eraseSessionAction(
  formId: string,
  shown: string | undefined,
  sessionId: string,
  reason: ErasureReason,
  proposal?: AgentProposalRef,
): Promise<EraseState> {
  const session = await requireAdminSession();
  if (!isErasureReason(reason)) {
    return { status: "error", message: t("ops.error.invalidErasureReason") };
  }
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await eraseSession(session, formId, sessionId, reason, proposal);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/operations/forms/${formId}/responses`);
  revalidatePath(`/operations/forms/${formId}/responses/${sessionId}`);
  revalidatePath("/responses/erasures");
  return { status: "erased", data: result.data };
}

/** The known-target lookup: whether one session id exists in this form and environment, read without its answers. */
export async function erasureLookupAction(
  formId: string,
  shown: string | undefined,
  sessionId: string,
): Promise<KnownTargetLookup> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await erasureScope(session, formId, sessionId.trim());
  if (result.ok) return { status: "found", scope: result.data };
  // A malformed id names no session either, and saying which would only describe the format.
  if (result.code === "SESSION_NOT_FOUND" || result.code === "INVALID_SESSION_ID") {
    return { status: "missing" };
  }
  return { status: "error", message: result.message };
}

export async function unflagResponseAction(
  formId: string,
  shown: string | undefined,
  sessionId: string,
  proposal?: AgentProposalRef,
): Promise<UnflagState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await unflagResponse(session, formId, sessionId, proposal);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath(`/operations/forms/${formId}/responses`);
  revalidatePath(`/operations/forms/${formId}/responses/${sessionId}`);
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return { status: "unflagged", released: result.data.released };
}
