"use server";

import { revalidatePath } from "next/cache";

import type { WebhookActionState } from "@/components/ops/webhook-config";
import type { RedeliverState } from "@/components/ops/dead-letters";
import { t } from "@/lib/i18n/en";
import {
  confirmEndpointProposal,
  createWebhook,
  deactivateWebhook,
  reactivateWebhook,
  redeliver,
  retargetWebhook,
  rotateWebhookSecret,
  withdrawEndpointProposal,
  type ConfigureOutcome,
} from "@/lib/server/webhook-ops";
import type { AgentProposalRef } from "@/lib/server/agent-proposal";
import { confirmShownEnvironment } from "@/lib/server/environments";
import { requireAdminSession } from "@/lib/server/session";

/* Plaintext webhook secrets pass straight to the caller for one display; never log, persist, or cache them
   here. */

export async function createWebhookAction(
  formId: string,
  shown: string | undefined,
  request: { readonly url: string; readonly active: boolean },
  proposal?: AgentProposalRef,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await createWebhook(session, formId, request, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.createFailed", { message: result.message }),
    };
  }
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return settled(result.data, (applied) => ({ status: "done", revealed: applied }));
}

export async function rotateSecretAction(
  formId: string,
  shown: string | undefined,
  webhookId: string,
  proposal?: AgentProposalRef,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await rotateWebhookSecret(session, formId, webhookId, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.rotateFailed", { message: result.message }),
    };
  }
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return settled(result.data, (applied) => ({ status: "done", revealed: applied }));
}

export async function deactivateWebhookAction(
  formId: string,
  shown: string | undefined,
  webhookId: string,
  proposal?: AgentProposalRef,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await deactivateWebhook(session, formId, webhookId, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.deactivateFailed", { message: result.message }),
    };
  }
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return settled(result.data, () => ({ status: "done" }));
}

export async function reactivateWebhookAction(
  formId: string,
  shown: string | undefined,
  webhookId: string,
  proposal?: AgentProposalRef,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await reactivateWebhook(session, formId, webhookId, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.reactivateFailed", { message: result.message }),
    };
  }
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return settled(result.data, () => ({ status: "done" }));
}

export async function retargetWebhookAction(
  formId: string,
  shown: string | undefined,
  webhookId: string,
  url: string,
  proposal?: AgentProposalRef,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await retargetWebhook(session, formId, webhookId, url, proposal);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.retargetFailed", { message: result.message }),
    };
  }
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return settled(result.data, () => ({ status: "done" }));
}

export async function redeliverAction(
  shown: string | undefined,
  formId: string,
  deliveryId: string,
  proposal?: AgentProposalRef,
): Promise<RedeliverState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await redeliver(session, formId, deliveryId, check.environment, proposal);
  if (!result.ok) return { status: "error", message: result.message };
  revalidatePath("/webhooks");
  return { status: "done", queued: 1, failed: 0 };
}

export async function redeliverAllAction(
  shown: string | undefined,
  targets: readonly { readonly formId: string; readonly deliveryId: string }[],
): Promise<RedeliverState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  let queued = 0;
  let failed = 0;
  let lastMessage = "";
  for (const { formId, deliveryId } of targets) {
    const result = await redeliver(session, formId, deliveryId, check.environment);
    if (result.ok) queued += 1;
    else {
      failed += 1;
      lastMessage = result.message;
    }
  }
  revalidatePath("/webhooks");
  if (queued === 0 && failed > 0) return { status: "error", message: lastMessage };
  return { status: "done", queued, failed };
}

/* A pending two-person change is not an applied endpoint mutation; preserve that distinction in every
   result. */
function settled<T>(
  result: ConfigureOutcome<T>,
  applied: (value: T) => WebhookActionState,
): WebhookActionState {
  if (!result.pending) return applied(result.applied);
  return {
    status: "pending",
    pending: result.proposal,
    ...(result.secret === undefined
      ? {}
      : {
          revealed: {
            webhookId: result.proposal.webhookId,
            url: result.proposal.url ?? "",
            active: result.proposal.active ?? true,
            secret: result.secret,
          },
        }),
  };
}

export async function confirmEndpointChangeAction(
  formId: string,
  shown: string | undefined,
  proposalId: string,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await confirmEndpointProposal(session, formId, proposalId, check.environment);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.proposals.confirmFailed", { message: result.message }),
    };
  }
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return { status: "done" };
}

export async function withdrawEndpointChangeAction(
  formId: string,
  shown: string | undefined,
  proposalId: string,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const check = await confirmShownEnvironment(session, shown);
  if (!check.ok) return { status: "error", message: check.message };
  const result = await withdrawEndpointProposal(session, formId, proposalId, check.environment);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.proposals.withdrawFailed", { message: result.message }),
    };
  }
  revalidatePath(`/operations/forms/${formId}/webhooks`);
  return { status: "done" };
}
