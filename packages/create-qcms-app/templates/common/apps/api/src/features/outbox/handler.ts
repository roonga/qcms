// Responses here must carry ids, urls, event types, attempt counts and value-free error
// codes only, never a secret, a payload or an answer value (SEC-8). The stored request
// headers already have the HMAC replaced by `SIGNATURE_MASK` at write time, so no
// signature can pass through even by accident (SEC-6, SEC-13).

import type { RouteHandler } from "@hono/zod-openapi";
import { parseFormId } from "@roonga/qcms-core";
import {
  getForm,
  listDeadLetterDeliveries,
  listRecentDeliveries,
  redeliveryRefusalFor,
  resetDeliveryForRedelivery,
  type DeliveryView,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { endpointUrlFor } from "../webhooks/mask.js";
import type { deadLettersRoute, deliveriesRoute, redeliverRoute } from "./route.js";
import { isDeliveryId } from "./schema.js";

const fail = {
  deliveryNotFound: (): ApiError =>
    new ApiError("DELIVERY_NOT_FOUND", 404, "No such webhook delivery"),
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  // Deliberately cause-free: erasure and the retention sweep both redact a payload, and
  // the two are indistinguishable from the delivery row, so the code names the state.
  notRedeliverable: (): ApiError =>
    new ApiError(
      "DELIVERY_NOT_REDELIVERABLE",
      409,
      "The response this delivery carries is no longer held, so it will not be re-sent",
    ),
} as const;

const DEFAULT_DELIVERY_LIMIT = 50;
// Caps `?limit` so one request cannot pull the whole history.
const MAX_DELIVERY_LIMIT = 200;

export function makeDeadLettersHandler(deps: Deps): RouteHandler<typeof deadLettersRoute, ApiEnv> {
  return async (c) => {
    const rows = await listDeadLetterDeliveries(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
    );
    return c.json(
      {
        deadLetters: rows.map((r) => ({
          deliveryId: r.deliveryId,
          eventId: r.outboxId,
          eventType: r.eventType,
          webhookId: r.webhookId,
          // The worklist is cross-form and redelivery is form-scoped, so each row has to
          // carry the form needed to act on it.
          formId: r.formId,
          url: r.url,
          attempts: r.attempts,
          lastError: r.lastError,
          deadLetteredAt: r.deadLetteredAt === null ? null : r.deadLetteredAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
      },
      200,
    );
  };
}

// Check order matters: a row can carry several timestamps at once, so the most recent
// outcome has to win. `delivered` outranks `cancelled` because an event that has already
// left was never cancelled, and `cancelled` outranks `deadLettered` because cancellation
// is the later, terminal fact.
function deliveryStatus(row: DeliveryView): "delivered" | "cancelled" | "deadLettered" | "pending" {
  if (row.deliveredAt !== null) return "delivered";
  if (row.cancelledAt !== null) return "cancelled";
  if (row.deadLetteredAt !== null) return "deadLettered";
  return "pending";
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DELIVERY_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIVERY_LIMIT;
  return Math.min(parsed, MAX_DELIVERY_LIMIT);
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function makeDeliveriesHandler(deps: Deps): RouteHandler<typeof deliveriesRoute, ApiEnv> {
  return async (c) => {
    const parsed = parseFormId(c.req.valid("param").id);
    if (!parsed.ok) throw fail.invalidId();
    const form = await getForm(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      parsed.value,
    );
    if (form === undefined) throw fail.formNotFound();

    const rows = await listRecentDeliveries(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      parsed.value,
      parseLimit(c.req.valid("query").limit),
    );
    // The URL masking has to reach this list too: it is the same stored URL reaching the
    // same role by a second route.
    const visibility = c.get("grantContext")?.endpointUrl;
    return c.json(
      {
        deliveries: rows.map((r) => ({
          deliveryId: r.deliveryId,
          eventId: r.outboxId,
          eventType: r.eventType,
          webhookId: r.webhookId,
          url: endpointUrlFor(r.url, visibility),
          status: deliveryStatus(r),
          attempts: r.attempts,
          lastError: r.lastError,
          createdAt: r.createdAt.toISOString(),
          deliveredAt: iso(r.deliveredAt),
          deadLetteredAt: iso(r.deadLetteredAt),
          cancelledAt: iso(r.cancelledAt),
          cancelledReason: r.cancelledReason,
          nextAttemptAt: r.nextAttemptAt.toISOString(),
          lastAttemptAt: iso(r.lastAttemptAt),
          lastStatus: r.lastStatus,
          latencyMs: r.lastLatencyMs,
          requestHeaders: r.lastRequestHeaders,
          responseSnippet: r.lastResponseSnippet,
          responseSnippetRedactedAt: iso(r.lastResponseSnippetRedactedAt),
        })),
      },
      200,
    );
  };
}

export function makeRedeliverHandler(deps: Deps): RouteHandler<typeof redeliverRoute, ApiEnv> {
  return async (c) => {
    const { id, deliveryId } = c.req.valid("param");

    // Every not-found-ish outcome on this endpoint is one code, so a caller cannot sort
    // "malformed form" from "no such delivery" from "not your form". Hence the 404 for a
    // malformed form id, and no separate existence check: the form is threaded into both
    // queries below, which already match nothing for an unknown one.
    const parsed = parseFormId(id);
    if (!parsed.ok) throw fail.deliveryNotFound();
    const formId = parsed.value;

    // Without this a malformed id reaches Postgres and raises `22P02` as a 500. The check
    // sits here rather than on the param schema because a schema rejection is a 400.
    if (!isDeliveryId(deliveryId)) throw fail.deliveryNotFound();

    // Refuse before resetting (ADR-17): `redeliveryRefusalFor` reads exactly the columns
    // the scheduler's claim filters on, so a row that could never be claimed is not put
    // back on the queue as "pending". This read must stay form-scoped, or it answers 409
    // for another form's redacted delivery where an unknown id answers 404, which reports
    // that someone else's row exists.
    if (
      (await redeliveryRefusalFor(
        deps.databases.forRequest(c.get("requestEnvironment")).exec,
        formId,
        deliveryId,
      )) !== undefined
    ) {
      throw fail.notRedeliverable();
    }

    const reset = await resetDeliveryForRedelivery(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      deliveryId,
      deps.clock.now(),
    );
    if (reset === undefined) throw fail.deliveryNotFound();
    return c.json(
      {
        deliveryId: reset.id,
        status: "pending" as const,
        attempts: 0 as const,
        nextAttemptAt: reset.nextAttemptAt.toISOString(),
      },
      200,
    );
  };
}
