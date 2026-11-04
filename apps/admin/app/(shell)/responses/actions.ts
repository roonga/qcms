"use server";

import { revalidatePath } from "next/cache";

import type { ErasureReason } from "@/lib/ops/erasure";
import { isErasureReason } from "@/lib/ops/erasure";
import type { EraseOutcome } from "@/lib/ops/types";
import { t } from "@/lib/i18n/en";
import { confirmShownEnvironment } from "@/lib/server/environments";
import type { AgentProposalRef } from "@/lib/server/agent-proposal";
import { eraseSession, unflagResponse } from "@/lib/server/responses";
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
  revalidatePath(`/forms/${formId}/responses`);
  revalidatePath(`/forms/${formId}/responses/${sessionId}`);
  revalidatePath("/responses/erasures");
  return { status: "erased", data: result.data };
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
  revalidatePath(`/forms/${formId}/responses`);
  revalidatePath(`/forms/${formId}/responses/${sessionId}`);
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "unflagged", released: result.data.released };
}
