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

/**
 * The webhook-operations mutations (task 035).
 *
 * ## The secret is returned and nothing else happens to it
 *
 * `createWebhookAction` and `rotateSecretAction` are the only two functions in this
 * app that ever hold a plaintext webhook secret. Each hands it straight back to the
 * component that displays it once. It is not logged, not put in a revalidation key,
 * not stored, and not re-sent (SEC-6, SEC-8, SEC-13). Note what is deliberately
 * absent: there is no "show secret" action anywhere, because there is no route that
 * could serve one.
 *
 * ## Redelivering all is a loop with a two-sided report
 *
 * The API's unit is one delivery. `redeliverAllAction` loops over ids the operator
 * can see and counts both outcomes, so a partly-broken queue reports as partly
 * queued rather than as a failure or as a success. The calls run in sequence rather
 * than together: a queue can hold hundreds of rows, and firing that many concurrent
 * writes at one Postgres from a UI button is a self-inflicted load spike for no gain
 * on an action nobody is waiting on interactively.
 *
 * `requireAdminSession()` is called in each exported function: a `"use server"`
 * module is reached directly and the shell layout's gate does not cover it (#177).
 *
 * Endpoints and their deliveries live in one environment's data plane, so every function
 * here also takes the environment its screen showed, bound by the page, and refuses when
 * the request resolves to another (local UX list A1; `forms/actions.ts` gives the
 * reasoning). The redelivery pair take it first because their page binds nothing else.
 */

/** Configure a new endpoint. The response carries the secret exactly once. */
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
  revalidatePath(`/forms/${formId}/webhooks`);
  return settled(result.data, (applied) => ({ status: "done", revealed: applied }));
}

/** Rotate an endpoint's secret. The new one is shown once and never again. */
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
  revalidatePath(`/forms/${formId}/webhooks`);
  return settled(result.data, (applied) => ({ status: "done", revealed: applied }));
}

/** Stop delivering to an endpoint (soft: the row and its history stay). */
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
  revalidatePath(`/forms/${formId}/webhooks`);
  return settled(result.data, () => ({ status: "done" }));
}

/** Put a deactivated endpoint back in service. */
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
  revalidatePath(`/forms/${formId}/webhooks`);
  return settled(result.data, () => ({ status: "done" }));
}

/** Point an endpoint somewhere else - the "fix the target" half of the redeliver loop. */
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
  revalidatePath(`/forms/${formId}/webhooks`);
  return settled(result.data, () => ({ status: "done" }));
}

/**
 * Reset one dead-lettered delivery to due-now.
 *
 * Takes the form as well as the delivery (issue #305): redelivery is form-scoped
 * server-side, so the caller names the form it believes the delivery belongs to and
 * the API refuses the pair if it does not hold.
 */
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

/**
 * Reset every dead-lettered delivery the operator can currently see.
 *
 * The worklist spans forms, so each entry carries its own form rather than the
 * batch sharing one (issue #305).
 */
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

/**
 * Turn a configure outcome into the state the panel renders (Q30, Q51; task 070).
 *
 * One helper for all five mutations, because the two-person rule answers each of them the
 * same way: either the endpoint changed, or the change is **stored pending** and the
 * endpoint is exactly as it was. The pending branch carries the proposal so the panel can
 * name the second account it is waiting for, and carries the secret where the change sets
 * one - shown once here as it would have been on a change that applied at once (SEC-6).
 */
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

/**
 * Confirm a pending `prod` endpoint change: the second of Q51's two acts.
 *
 * **Refused for the account that proposed it**, and refused for anybody who does not hold
 * `forms.approver` with this environment in scope. Neither refusal is this app's to make
 * (R2): the API answers both and this reports the answer.
 */
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
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "done" };
}

/** Withdraw a pending `prod` endpoint change, applying it to nothing. */
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
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "done" };
}
