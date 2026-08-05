/**
 * Outbox delivery-operations admin handlers (task 025).
 *
 * Three operator reads/actions over the delivery surface (§5.3, ARCHITECTURE §10):
 * list dead-lettered deliveries with their attempt history, list one form's recent
 * deliveries with the record of their last attempt (task 035's dashboard), and
 * manually redeliver one (reset it to due-now so the next pass re-attempts it).
 * Honest transaction scripts (R5) over the `@qcms/db` delivery helpers - no
 * cross-row invariant, no signing/HTTP here (that is the delivery pass).
 * Fetch-pure (R4): time via `deps.clock`, no `node:*`.
 *
 * SEC-8: responses carry ids, urls, event types, attempt counts, and value-free
 * error codes only - never a secret, a payload, or an answer value. The request
 * headers on the deliveries list are the stored ones, which the deliverer wrote with
 * the HMAC already replaced by `SIGNATURE_MASK`, so no signature can pass through
 * here even by accident (SEC-6, SEC-13).
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { parseFormId } from "@qcms/core";
import {
  deliveryTargetsErasedSession,
  getForm,
  listDeadLetterDeliveries,
  listRecentDeliveries,
  resetDeliveryForRedelivery,
  type DeliveryView,
} from "@qcms/db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { deadLettersRoute, deliveriesRoute, redeliverRoute } from "./route.js";

const fail = {
  deliveryNotFound: (): ApiError =>
    new ApiError("DELIVERY_NOT_FOUND", 404, "No such webhook delivery"),
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  sessionErased: (): ApiError =>
    new ApiError(
      "DELIVERY_SESSION_ERASED",
      409,
      "This delivery carries an erased session's response and will not be re-sent",
    ),
} as const;

/** How many deliveries a dashboard page shows when the caller names no limit. */
const DEFAULT_DELIVERY_LIMIT = 50;
/** The ceiling on `?limit`, so one request cannot pull the whole history. */
const MAX_DELIVERY_LIMIT = 200;

// --- GET /admin/outbox/dead-letters -----------------------------------------

export function makeDeadLettersHandler(deps: Deps): RouteHandler<typeof deadLettersRoute, ApiEnv> {
  return async (c) => {
    const rows = await listDeadLetterDeliveries(deps.db);
    return c.json(
      {
        deadLetters: rows.map((r) => ({
          deliveryId: r.deliveryId,
          eventId: r.outboxId,
          eventType: r.eventType,
          webhookId: r.webhookId,
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

// --- GET /admin/forms/:id/deliveries ----------------------------------------

/**
 * The delivery status, derived from the lifecycle timestamps rather than stored.
 *
 * Order matters: a delivered row can also carry a `deadLetteredAt` from an earlier
 * life if it was redelivered after dead-lettering (the reset clears it, but a future
 * caller of `markDeliveryDelivered` need not), so "delivered" is checked first and
 * the most recent outcome wins.
 */
function deliveryStatus(row: DeliveryView): "delivered" | "deadLettered" | "pending" {
  if (row.deliveredAt !== null) return "delivered";
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
    const form = await getForm(deps.db, parsed.value);
    if (form === undefined) throw fail.formNotFound();

    const rows = await listRecentDeliveries(
      deps.db,
      parsed.value,
      parseLimit(c.req.valid("query").limit),
    );
    return c.json(
      {
        deliveries: rows.map((r) => ({
          deliveryId: r.deliveryId,
          eventId: r.outboxId,
          eventType: r.eventType,
          webhookId: r.webhookId,
          url: r.url,
          status: deliveryStatus(r),
          attempts: r.attempts,
          lastError: r.lastError,
          createdAt: r.createdAt.toISOString(),
          deliveredAt: iso(r.deliveredAt),
          deadLetteredAt: iso(r.deadLetteredAt),
          nextAttemptAt: r.nextAttemptAt.toISOString(),
          lastAttemptAt: iso(r.lastAttemptAt),
          lastStatus: r.lastStatus,
          latencyMs: r.lastLatencyMs,
          requestHeaders: r.lastRequestHeaders,
          responseSnippet: r.lastResponseSnippet,
        })),
      },
      200,
    );
  };
}

// --- POST /admin/outbox/:id/redeliver ---------------------------------------

export function makeRedeliverHandler(deps: Deps): RouteHandler<typeof redeliverRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");

    // ADR-17: refuse before resetting. The outbox payload still holds the whole locked
    // answer set - `eraseSession` deletes the ledger and the submission, not the queued
    // event - so redelivering an erased session's event would transmit exactly what the
    // erasure removed from the list, the detail and the export. Checked here rather than
    // in the deliverer because this is the door THIS task opened: an operator clearing a
    // stuck queue must not be the reason those answers go out. Bulk redelivery is the
    // same endpoint called per item, so it is covered by construction.
    if (await deliveryTargetsErasedSession(deps.db, id)) throw fail.sessionErased();

    const reset = await resetDeliveryForRedelivery(deps.db, id, deps.clock.now());
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
