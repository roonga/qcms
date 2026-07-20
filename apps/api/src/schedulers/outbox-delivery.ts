/**
 * The outbox webhook-delivery pass (task 025; ARCHITECTURE §5.3, §11).
 *
 * This is the real work the 017 scheduler shell invokes each tick. It drains the
 * transactional outbox the submission wrote (020) and delivers `response.submitted`
 * events to every active webhook a form configured (024), with HMAC signing,
 * capped exponential backoff, and dead-lettering. **At-least-once, never
 * best-effort.** Fetch-pure (R4): time via `deps.clock`, HTTP via the web `fetch`,
 * HMAC via WebCrypto (`./signing`), secret decryption via WebCrypto (`../features/
 * webhooks/crypto`) - no `node:*`.
 *
 * ## Two phases, each `FOR UPDATE SKIP LOCKED` (multi-instance safe)
 *
 * 1. **Materialize.** Claim due outbox events and fan each `response.submitted`
 *    out to one `webhook_deliveries` row per *active* webhook (idempotent via the
 *    `(outbox_id, webhook_id)` unique key), then mark the outbox row consumed. The
 *    outbox is the fan-out source; the delivery rows are the per-endpoint queue,
 *    each with its own independent retry state (so one webhook failing never
 *    stalls another - exit criterion 5). Event types with no launch subscriber
 *    (e.g. `form.published`) are consumed without fan-out.
 * 2. **Deliver.** Claim a due delivery row in its own transaction - which holds
 *    the row lock across the POST - sign and send, then record the outcome and
 *    commit. Holding the lock across the POST is what makes it *exclusive* across
 *    concurrent deliverers (`SKIP LOCKED`: a second instance skips the locked row)
 *    and *crash-safe* (a crash between send and commit rolls back to a
 *    redeliverable state - the consumer may see a duplicate; `eventId` +
 *    `contentHash` are the idempotency keys).
 *
 * ## SSRF defense-in-depth
 *
 * The target URL was checked at config time (024); it is re-checked here on the
 * literal URL before every POST. This still cannot fully close DNS rebinding -
 * the hostname could resolve to a private address at fetch time - which is an
 * inherent limitation of URL-based SSRF guards; closing it fully needs
 * resolve-then-pin-the-IP at the socket layer, out of scope for launch (documented
 * in docs/webhooks.md).
 *
 * ## Logging (SEC-8)
 *
 * Only ids and per-pass counts are logged - never the payload, answer values, the
 * secret, or the signature. The event/webhook/delivery ids are safe correlators.
 */

import { type FormId, parseFormId } from "@qcms/core";
import {
  claimDue,
  claimDueDeliveries,
  insertDelivery,
  listWebhooks,
  markDelivered,
  markDeliveryDelivered,
  recordDeliveryFailure,
  type DueDelivery,
} from "@qcms/db";

import type { Deps } from "../deps.js";
import { decryptWebhookSecret } from "../features/webhooks/crypto.js";
import { signWebhookBody } from "../features/webhooks/signing.js";
import { checkWebhookUrl } from "../features/webhooks/ssrf.js";

/** The one event type fanned out to webhooks at launch. */
const RESPONSE_SUBMITTED = "response.submitted";

/** The subset of `fetch` the deliverer uses; injectable so tests can stub it. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface DeliveryPassOptions {
  /** HTTP transport; defaults to the global `fetch`. */
  readonly fetchImpl?: FetchLike;
  /** Override the clock for deterministic tests (else `deps.clock.now()`). */
  readonly now?: Date;
  /**
   * TEST-ONLY seam: invoked after a successful send but before the delivery is
   * marked delivered, inside the delivery transaction. A throw here rolls the
   * transaction back - exactly the crash-between-send-and-commit the at-least-once
   * contract must survive. Never set in production.
   */
  readonly afterSend?: (deliveryId: string) => void | Promise<void>;
}

/** Per-pass counts logged as structured fields (no secrets, no answer values). */
export interface DeliveryPassMetrics {
  /** Delivery rows created during materialization this pass. */
  readonly materialized: number;
  /** Delivery rows claimed for a delivery attempt. */
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly deadLettered: number;
}

/**
 * Run one full delivery pass: materialize newly-due outbox events into delivery
 * rows, then deliver due delivery rows. Logs the per-pass counts. Safe to invoke
 * concurrently across instances (both phases use `SKIP LOCKED`).
 */
export async function runDeliveryPass(
  deps: Deps,
  options: DeliveryPassOptions = {},
): Promise<DeliveryPassMetrics> {
  const materialized = await materialize(deps, options);
  const outcome = await deliverDue(deps, options);
  const metrics: DeliveryPassMetrics = { materialized, ...outcome };
  deps.logger.info("outbox delivery pass", { ...metrics });
  return metrics;
}

/**
 * Phase 1: claim due outbox events and fan `response.submitted` out to active
 * webhooks as delivery rows, consuming each event. One transaction - a crash
 * rolls back to un-fanned events, never to half-created deliveries.
 */
async function materialize(deps: Deps, options: DeliveryPassOptions): Promise<number> {
  const now = options.now ?? deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const events = await claimDue(tx, deps.config.webhooks.deliveryBatchSize, now);
    let created = 0;
    for (const event of events) {
      if (event.eventType === RESPONSE_SUBMITTED) {
        const formId = resolveFormId(event.payload);
        if (formId !== undefined) {
          const hooks = await listWebhooks(tx, formId);
          for (const hook of hooks) {
            if (!hook.active) continue;
            await insertDelivery(tx, { outboxId: event.id, webhookId: hook.webhookId }, now);
            created += 1;
          }
        } else {
          deps.logger.warn("outbox event has no resolvable formId; consuming without fan-out", {
            eventId: event.id,
          });
        }
      }
      // Consume the event regardless of type: the outbox is drained exactly once;
      // delivery rows now own the per-endpoint retry state.
      await markDelivered(tx, event.id, now);
    }
    return created;
  });
}

/** Extract and validate the branded `formId` from a `response.submitted` payload. */
function resolveFormId(payload: unknown): FormId | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const raw = (payload as { formId?: unknown }).formId;
  if (typeof raw !== "string") return undefined;
  const parsed = parseFormId(raw);
  return parsed.ok ? parsed.value : undefined;
}

/**
 * Phase 2: deliver due delivery rows, up to the configured batch size, each in its
 * own transaction that holds the row lock across the POST.
 */
async function deliverDue(
  deps: Deps,
  options: DeliveryPassOptions,
): Promise<Omit<DeliveryPassMetrics, "materialized">> {
  const now = options.now ?? deps.clock.now();
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;

  for (let i = 0; i < deps.config.webhooks.deliveryBatchSize; i += 1) {
    const outcome = await deps.db.transaction(async (tx) => {
      const [due] = await claimDueDeliveries(tx, 1, now);
      if (due === undefined) return "empty" as const;

      const result = await deliverOne(deps, due, options);

      // Crash seam (tests only): throwing here aborts the transaction after the
      // send, proving the row redelivers on a later pass (at-least-once).
      if (options.afterSend) await options.afterSend(due.deliveryId);

      if (result.ok) {
        await markDeliveryDelivered(tx, due.deliveryId, now);
        return "delivered" as const;
      }
      const row = await recordDeliveryFailure(tx, due.deliveryId, result.error, now);
      return row?.deadLetteredAt ? ("deadLettered" as const) : ("failed" as const);
    });

    if (outcome === "empty") break;
    claimed += 1;
    if (outcome === "delivered") delivered += 1;
    else if (outcome === "deadLettered") deadLettered += 1;
    else failed += 1;
  }

  return { claimed, delivered, failed, deadLettered };
}

/** The outcome of a single POST attempt: a 2xx, or a value-free failure reason. */
type DeliveryResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Sign and POST one delivery. Re-checks SSRF, decrypts the secret, builds the
 * enveloped body, signs it, and sends with a timeout. Never throws for a delivery
 * failure - a non-2xx, timeout, network error, decrypt failure, or SSRF rejection
 * all return `{ ok: false, error }` for {@link recordDeliveryFailure} to schedule.
 */
async function deliverOne(
  deps: Deps,
  due: DueDelivery,
  options: DeliveryPassOptions,
): Promise<DeliveryResult> {
  // SSRF re-check (defense-in-depth): reject private/reserved targets at delivery
  // time too, honoring the same on-prem override as config time.
  const checked = checkWebhookUrl(due.url, deps.config.webhooks.allowPrivateTargets);
  if (!checked.ok) return { ok: false, error: `ssrf_rejected:${checked.reason}` };

  let secret: string;
  try {
    secret = await decryptWebhookSecret(due.secretEncrypted, deps.config.keys.app);
  } catch {
    // The secret envelope is corrupt or the app key rotated away - retryable only
    // by fixing config, but recorded as a failure so it dead-letters visibly.
    return { ok: false, error: "secret_decrypt_failed" };
  }

  const now = options.now ?? deps.clock.now();
  const body = JSON.stringify({
    eventId: due.outboxId,
    eventType: due.eventType,
    deliveredAt: now.toISOString(),
    payload: due.payload,
  });
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const signature = await signWebhookBody(secret, timestamp, body);

  const fetchImpl: FetchLike = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.config.webhooks.deliveryTimeoutMs);
  try {
    const res = await fetchImpl(checked.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-event": due.eventType,
        "x-qcms-delivery": crypto.randomUUID(), // unique per attempt
        "x-qcms-timestamp": timestamp,
        "x-qcms-signature": signature,
      },
      body,
      signal: controller.signal,
    });
    // Drain the body so the connection can be reused; the content is ignored.
    await res.text().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, error: `http_${res.status}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
