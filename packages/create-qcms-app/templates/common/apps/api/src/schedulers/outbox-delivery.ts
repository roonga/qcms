/**
 * At-least-once: the row lock is held across the POST (`SKIP LOCKED`), so a crash rolls back
 * to redeliverable and `eventId` plus `contentHash` are the idempotency keys. Only ids and
 * counts are logged (SEC-8). The URL re-check cannot close DNS rebinding (docs/webhooks.md).
 */

import { type FormId, parseFormId } from "@roonga/qcms-core";
import {
  claimDue,
  claimDueDeliveries,
  insertDelivery,
  listWebhooks,
  markDelivered,
  markDeliveryDelivered,
  recordDeliveryFailure,
  type DeliveryAttemptRecord,
  type DueDelivery,
  type Executor,
  type OutboxRow,
} from "@roonga/qcms-db";

import type { Deps } from "../deps.js";
import { decryptWebhookSecret } from "../features/webhooks/crypto.js";
import { signWebhookBody } from "../features/webhooks/signing.js";
import { checkWebhookUrl } from "../features/webhooks/ssrf.js";

const RESPONSE_SUBMITTED = "response.submitted";

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Masked at the point of writing, so the HMAC is absent from the database entirely and
 * no later reader can leak it by forgetting to redact (SEC-6, SEC-13). The header name
 * is kept: an operator debugging a rejecting consumer needs to see that it was signed.
 */
export const SIGNATURE_MASK = "v1=<masked>";

/** Short enough that a consumer returning a whole HTML error page cannot bloat the row. */
export const RESPONSE_SNIPPET_MAX = 500;

export interface DeliveryPassOptions {
  readonly fetchImpl?: FetchLike;
  readonly now?: Date;
  /**
   * TEST-ONLY seam, never set in production: a throw here rolls the delivery
   * transaction back after the send, which is the crash the at-least-once contract
   * must survive.
   */
  readonly afterSend?: (deliveryId: string) => void | Promise<void>;
  /** The scheduler never defaults this; it names each environment in turn. */
  readonly environment?: string;
}

export interface DeliveryPassMetrics {
  readonly materialized: number;
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly deadLettered: number;
}

export async function runDeliveryPass(
  deps: Deps,
  options: DeliveryPassOptions = {},
): Promise<DeliveryPassMetrics> {
  const environment = options.environment ?? deps.databases.forRequest().environment;
  const exec = deps.databases.for(environment);
  const materialized = await materialize(deps, exec, options);
  const outcome = await deliverDue(deps, exec, options);
  const metrics: DeliveryPassMetrics = { materialized, ...outcome };
  deps.logger.info("outbox delivery pass", { environment, ...metrics });
  return metrics;
}

/**
 * One scheduler per process iterates rather than multiplying, so the
 * scheduler-singleton rule in `docs/deploy-enterprise.md` holds. A failing environment
 * is logged and stepped over: one unreachable database must not stop another's queue
 * from draining.
 */
export async function runDeliveryPassForEveryEnvironment(
  deps: Deps,
  options: DeliveryPassOptions = {},
): Promise<void> {
  for (const environment of deps.databases.names) {
    try {
      await runDeliveryPass(deps, { ...options, environment });
    } catch (error: unknown) {
      deps.logger.error("outbox delivery pass failed", { environment, err: error });
    }
  }
}

/** One transaction, so a crash rolls back to un-fanned events, never half-created rows. */
async function materialize(
  deps: Deps,
  exec: Executor,
  options: DeliveryPassOptions,
): Promise<number> {
  const now = options.now ?? deps.clock.now();
  return exec.transaction(async (tx) => {
    const events = await claimDue(tx, deps.config.webhooks.deliveryBatchSize, now);
    let created = 0;
    for (const event of events) {
      created += await fanOutEvent(deps, tx, event, now);
      // Consumed regardless of type: delivery rows own the per-endpoint retry state.
      await markDelivered(tx, event.id, now);
    }
    return created;
  });
}

async function fanOutEvent(deps: Deps, tx: Executor, event: OutboxRow, now: Date): Promise<number> {
  if (event.eventType !== RESPONSE_SUBMITTED) return 0;
  const formId = resolveFormId(event.payload);
  if (formId === undefined) {
    deps.logger.warn("outbox event has no resolvable formId; consuming without fan-out", {
      eventId: event.id,
    });
    return 0;
  }
  const hooks = await listWebhooks(tx, formId);
  let created = 0;
  for (const hook of hooks) {
    if (!hook.active) continue;
    await insertDelivery(tx, { outboxId: event.id, webhookId: hook.webhookId }, now);
    created += 1;
  }
  return created;
}

function resolveFormId(payload: unknown): FormId | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const raw = (payload as { formId?: unknown }).formId;
  if (typeof raw !== "string") return undefined;
  const parsed = parseFormId(raw);
  return parsed.ok ? parsed.value : undefined;
}

async function deliverDue(
  deps: Deps,
  exec: Executor,
  options: DeliveryPassOptions,
): Promise<Omit<DeliveryPassMetrics, "materialized">> {
  const now = options.now ?? deps.clock.now();
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;

  for (let i = 0; i < deps.config.webhooks.deliveryBatchSize; i += 1) {
    const outcome = await exec.transaction(async (tx) => {
      const [due] = await claimDueDeliveries(tx, 1, now);
      if (due === undefined) return "empty" as const;

      const result = await deliverOne(deps, due, options);

      if (options.afterSend) await options.afterSend(due.deliveryId);

      if (result.ok) {
        await markDeliveryDelivered(tx, due.deliveryId, now, result.attempt);
        return "delivered" as const;
      }
      const row = await recordDeliveryFailure(
        tx,
        due.deliveryId,
        result.error,
        now,
        result.attempt,
      );
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

/** `attempt` is absent only when the send never reached the transport at all. */
type DeliveryResult =
  | { readonly ok: true; readonly attempt: DeliveryAttemptRecord }
  | {
      readonly ok: false;
      readonly error: string;
      readonly attempt?: DeliveryAttemptRecord;
    };

/** Never throws for a delivery failure: the caller needs it recorded, not raised. */
async function deliverOne(
  deps: Deps,
  due: DueDelivery,
  options: DeliveryPassOptions,
): Promise<DeliveryResult> {
  // Re-checked at delivery time as well as at config time (defense in depth).
  const checked = checkWebhookUrl(due.url, deps.config.webhooks.allowPrivateTargets);
  if (!checked.ok) return { ok: false, error: `ssrf_rejected:${checked.reason}` };

  let secret: string;
  try {
    secret = await decryptWebhookSecret(due.secretEncrypted, deps.config.keys.app);
  } catch {
    // Corrupt envelope or a rotated app key: recorded as a failure so it dead-letters
    // visibly rather than silently stalling.
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

  const headers = {
    "content-type": "application/json",
    "x-qcms-event": due.eventType,
    "x-qcms-delivery": crypto.randomUUID(),
    "x-qcms-timestamp": timestamp,
    "x-qcms-signature": signature,
  };
  const storedHeaders: Record<string, string> = { ...headers, "x-qcms-signature": SIGNATURE_MASK };

  const fetchImpl: FetchLike = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.config.webhooks.deliveryTimeoutMs);
  // Monotonic clock, not `deps.clock`: that is frozen in tests, zeroing every latency.
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);
  try {
    const res = await fetchImpl(checked.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    // Read even when unused, so the connection can be reused.
    const responseBody = await res.text().catch(() => "");
    const attempt: DeliveryAttemptRecord = {
      lastAttemptAt: now,
      lastStatus: res.status,
      lastLatencyMs: elapsed(),
      lastRequestHeaders: storedHeaders,
      lastResponseSnippet: responseBody.slice(0, RESPONSE_SNIPPET_MAX),
    };
    if (res.status >= 200 && res.status < 300) return { ok: true, attempt };
    return { ok: false, error: `http_${res.status}`, attempt };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "timeout" : "network_error",
      attempt: {
        lastAttemptAt: now,
        lastStatus: null,
        lastLatencyMs: elapsed(),
        lastRequestHeaders: storedHeaders,
        lastResponseSnippet: null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
