"use server";

import { revalidatePath } from "next/cache";

import type { WebhookActionState } from "@/components/ops/webhook-config";
import type { RedeliverState } from "@/components/ops/dead-letters";
import { t } from "@/lib/i18n/en";
import {
  createWebhook,
  deactivateWebhook,
  reactivateWebhook,
  redeliver,
  retargetWebhook,
  rotateWebhookSecret,
} from "@/lib/server/webhook-ops";
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
 */

/** Configure a new endpoint. The response carries the secret exactly once. */
export async function createWebhookAction(
  formId: string,
  request: { readonly url: string; readonly active: boolean },
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const result = await createWebhook(session, formId, request);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.createFailed", { message: result.message }),
    };
  }
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "done", revealed: result.data };
}

/** Rotate an endpoint's secret. The new one is shown once and never again. */
export async function rotateSecretAction(
  formId: string,
  webhookId: string,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const result = await rotateWebhookSecret(session, formId, webhookId);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.rotateFailed", { message: result.message }),
    };
  }
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "done", revealed: result.data };
}

/** Stop delivering to an endpoint (soft: the row and its history stay). */
export async function deactivateWebhookAction(
  formId: string,
  webhookId: string,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const result = await deactivateWebhook(session, formId, webhookId);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.deactivateFailed", { message: result.message }),
    };
  }
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "done" };
}

/** Put a deactivated endpoint back in service. */
export async function reactivateWebhookAction(
  formId: string,
  webhookId: string,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const result = await reactivateWebhook(session, formId, webhookId);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.reactivateFailed", { message: result.message }),
    };
  }
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "done" };
}

/** Point an endpoint somewhere else - the "fix the target" half of the redeliver loop. */
export async function retargetWebhookAction(
  formId: string,
  webhookId: string,
  url: string,
): Promise<WebhookActionState> {
  const session = await requireAdminSession();
  const result = await retargetWebhook(session, formId, webhookId, url);
  if (!result.ok) {
    return {
      status: "error",
      message: t("ops.webhooks.retargetFailed", { message: result.message }),
    };
  }
  revalidatePath(`/forms/${formId}/webhooks`);
  return { status: "done" };
}

/**
 * Reset one dead-lettered delivery to due-now.
 *
 * Takes the form as well as the delivery (issue #305): redelivery is form-scoped
 * server-side, so the caller names the form it believes the delivery belongs to and
 * the API refuses the pair if it does not hold.
 */
export async function redeliverAction(
  formId: string,
  deliveryId: string,
): Promise<RedeliverState> {
  const session = await requireAdminSession();
  const result = await redeliver(session, formId, deliveryId);
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
  targets: readonly { readonly formId: string; readonly deliveryId: string }[],
): Promise<RedeliverState> {
  const session = await requireAdminSession();
  let queued = 0;
  let failed = 0;
  let lastMessage = "";
  for (const { formId, deliveryId } of targets) {
    const result = await redeliver(session, formId, deliveryId);
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
