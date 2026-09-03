import type {
  DeadLetterItem,
  DeliveryItem,
  DeliveryStatus,
  RevealedWebhook,
  WebhookSummary,
} from "../ops/types.ts";

import { adminApiFetch } from "./api.ts";
import type { AdminApiPath } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/**
 * The webhook configuration and delivery-operations screens' calls into the API's
 * `/admin` group (task 035, R2).
 *
 * ## The secret exists once, and this file is the narrowest place it passes through
 *
 * `POST /forms/{id}/webhooks` and a rotating `PUT` are the only two responses that
 * will ever carry a webhook's plaintext secret: the API stores AES-256-GCM
 * ciphertext under `QCMS_APP_KEY` and has no route that decrypts it back out
 * (SEC-6). So the value is handed straight to the component that displays it and
 * touches nothing else on the way - it is never logged, never written to a cache,
 * never put in an error message, and never sent back up to be echoed (SEC-8,
 * SEC-13). {@link listWebhooks} has no field for it at all, which is the structural
 * half of the same promise: a screen cannot render a secret it was never given.
 *
 * ## Redelivery is per-item, including the bulk button
 *
 * The API's unit is one delivery (`POST /forms/{formId}/deliveries/{deliveryId}/redeliver`);
 * there is
 * no bulk endpoint and this file does not invent one. The bulk action loops here,
 * over ids the operator can see, and reports each outcome separately - so a queue
 * where three of ten targets are still broken tells the operator that, instead of
 * failing whole or claiming whole.
 */

/** `GET /admin/forms/{id}/webhooks` - the configured endpoints, secrets absent. */
export async function listWebhooks(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<readonly WebhookSummary[]>> {
  const result = await readResult<{ webhooks?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/webhooks`),
  );
  if (!result.ok) return result;
  return { ok: true, data: rows(result.data.webhooks).filter(isWebhook).map(parseWebhook) };
}

/** `POST /admin/forms/{id}/webhooks` - configure one. The secret comes back once. */
export async function createWebhook(
  session: AdminSession,
  formId: string,
  request: { readonly url: string; readonly active: boolean },
): Promise<ApiResult<RevealedWebhook>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/webhooks`, {
      method: "POST",
      body: request,
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseRevealed(result.data) };
}

/**
 * `PUT /admin/forms/{id}/webhooks/{webhookId}` - rotate the secret.
 *
 * Rotation is its own call rather than a flag on an edit, because it has its own
 * consequence: every consumer verifying with the old secret starts rejecting the
 * moment the next delivery is signed with the new one. The screen states that before
 * it asks.
 */
export async function rotateWebhookSecret(
  session: AdminSession,
  formId: string,
  webhookId: string,
): Promise<ApiResult<RevealedWebhook>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "PUT", body: { rotateSecret: true } },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseRevealed({ ...result.data, webhookId }) };
}

/**
 * `DELETE /admin/forms/{id}/webhooks/{webhookId}` - stop delivering to it.
 *
 * A soft deactivate: the row stays, so its delivery history stays readable and the
 * endpoint can be reactivated. Nothing in flight is cancelled - a delivery already
 * materialized keeps its own retry state.
 */
export async function deactivateWebhook(
  session: AdminSession,
  formId: string,
  webhookId: string,
): Promise<ApiResult<{ readonly webhookId: string }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "DELETE" },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: { webhookId: text(result.data["webhookId"], webhookId) } };
}

/** `PUT .../{webhookId}` with `active: true` - put a deactivated endpoint back in service. */
export async function reactivateWebhook(
  session: AdminSession,
  formId: string,
  webhookId: string,
): Promise<ApiResult<{ readonly webhookId: string }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "PUT", body: { active: true } },
    ),
  );
  if (!result.ok) return result;
  return { ok: true, data: { webhookId: text(result.data["webhookId"], webhookId) } };
}

/** `PUT .../{webhookId}` with a new url - repointing a broken target. */
export async function retargetWebhook(
  session: AdminSession,
  formId: string,
  webhookId: string,
  url: string,
): Promise<ApiResult<{ readonly webhookId: string; readonly url: string }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "PUT", body: { url } },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      webhookId: text(result.data["webhookId"], webhookId),
      url: text(result.data["url"], url),
    },
  };
}

/** `GET /admin/forms/{id}/deliveries` - the dashboard's rows, newest first. */
export async function listDeliveries(
  session: AdminSession,
  formId: string,
  limit?: number,
): Promise<ApiResult<readonly DeliveryItem[]>> {
  const path: AdminApiPath = `/forms/${encodeURIComponent(formId)}/deliveries${
    limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`
  }`;
  const result = await readResult<{ deliveries?: unknown }>(await adminApiFetch(session, path));
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data.deliveries)
      .filter((entry) => typeof entry["deliveryId"] === "string")
      .map(parseDelivery),
  };
}

/**
 * `GET /admin/outbox/dead-letters` - the queue, across every form.
 *
 * Deliberately not form-scoped: "what is stuck anywhere" is the question this
 * worklist answers. Each row names its own form so the form-scoped redeliver call
 * can be built from the list (#305).
 */
export async function listDeadLetters(
  session: AdminSession,
): Promise<ApiResult<readonly DeadLetterItem[]>> {
  const result = await readResult<{ deadLetters?: unknown }>(
    await adminApiFetch(session, "/outbox/dead-letters"),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: rows(result.data.deadLetters)
      .filter((entry) => typeof entry["deliveryId"] === "string")
      .map((entry) => ({
        deliveryId: entry["deliveryId"] as string,
        eventId: text(entry["eventId"], ""),
        eventType: text(entry["eventType"], ""),
        webhookId: text(entry["webhookId"], ""),
        // The form the row belongs to, needed to build its redeliver call (#305).
        formId: text(entry["formId"], ""),
        url: text(entry["url"], ""),
        attempts: count(entry["attempts"], 0),
        lastError: nullableText(entry["lastError"]),
        deadLetteredAt: nullableText(entry["deadLetteredAt"]),
        createdAt: text(entry["createdAt"], ""),
      })),
  };
}

/**
 * `POST /admin/forms/{formId}/deliveries/{deliveryId}/redeliver` - reset one
 * delivery to due-now.
 *
 * The form is required (issue #305): redelivery is form-scoped server-side, and a
 * delivery id alone never said which form the caller was acting within. Dead-letter
 * rows carry their own `formId` for exactly this call, since that worklist is
 * cross-form.
 */
export async function redeliver(
  session: AdminSession,
  formId: string,
  deliveryId: string,
): Promise<ApiResult<{ readonly deliveryId: string; readonly nextAttemptAt: string }>> {
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      { method: "POST" },
    ),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      deliveryId: text(result.data["deliveryId"], deliveryId),
      nextAttemptAt: text(result.data["nextAttemptAt"], ""),
    },
  };
}

// --- reading the API's payloads ---------------------------------------------

const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "delivered",
  "cancelled",
  "deadLettered",
  "pending",
];

function text(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw !== "" ? raw : fallback;
}

function nullableText(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function count(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function nullableCount(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function rows(raw: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

function isWebhook(entry: Record<string, unknown>): boolean {
  return typeof entry["webhookId"] === "string";
}

function parseWebhook(entry: Record<string, unknown>): WebhookSummary {
  return {
    webhookId: entry["webhookId"] as string,
    url: text(entry["url"], ""),
    active: entry["active"] === true,
    deactivatedAt: nullableText(entry["deactivatedAt"]),
    createdAt: text(entry["createdAt"], ""),
    updatedAt: text(entry["updatedAt"], ""),
  };
}

/**
 * Read a create/rotate response.
 *
 * A response with no `secret` is a failure of this app's contract, not a variant to
 * render: the two routes that reach here always rotate. It reads as an empty string
 * rather than throwing, and the reveal panel renders `ops.webhooks.secretMissing` for
 * that case - recoverable (rotate again) in a way that a crashed screen is not, and
 * stated rather than shown as an empty box under "Copy this secret now".
 */
function parseRevealed(entry: Record<string, unknown>): RevealedWebhook {
  return {
    webhookId: text(entry["webhookId"], ""),
    url: text(entry["url"], ""),
    active: entry["active"] !== false,
    secret: typeof entry["secret"] === "string" ? entry["secret"] : "",
  };
}

/**
 * Read one delivery row.
 *
 * An unrecognised `status` reads as `pending`, and the direction is deliberate for
 * the same reason a link's unknown state reads as active: a delivery this build
 * cannot classify is one an operator may still need to act on, so it stays in the
 * list rather than being filtered out of the only screen that can redeliver it.
 */
function parseDelivery(entry: Record<string, unknown>): DeliveryItem {
  return {
    deliveryId: entry["deliveryId"] as string,
    eventId: text(entry["eventId"], ""),
    eventType: text(entry["eventType"], ""),
    webhookId: text(entry["webhookId"], ""),
    url: text(entry["url"], ""),
    status: DELIVERY_STATUSES.find((status) => status === entry["status"]) ?? "pending",
    attempts: count(entry["attempts"], 0),
    lastError: nullableText(entry["lastError"]),
    createdAt: text(entry["createdAt"], ""),
    deliveredAt: nullableText(entry["deliveredAt"]),
    deadLetteredAt: nullableText(entry["deadLetteredAt"]),
    cancelledAt: nullableText(entry["cancelledAt"]),
    cancelledReason: nullableText(entry["cancelledReason"]),
    nextAttemptAt: text(entry["nextAttemptAt"], ""),
    lastAttemptAt: nullableText(entry["lastAttemptAt"]),
    lastStatus: nullableCount(entry["lastStatus"]),
    latencyMs: nullableCount(entry["latencyMs"]),
    requestHeaders: headerMap(entry["requestHeaders"]),
    responseSnippet: nullableText(entry["responseSnippet"]),
    responseSnippetRedactedAt: nullableText(entry["responseSnippetRedactedAt"]),
  };
}

/** Only string-valued header entries survive; anything else is not a header. */
function headerMap(raw: unknown): Readonly<Record<string, string>> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length === 0 ? null : Object.fromEntries(entries);
}
