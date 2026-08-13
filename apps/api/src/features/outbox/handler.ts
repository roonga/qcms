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
  getForm,
  listDeadLetterDeliveries,
  listRecentDeliveries,
  redeliveryRefusalFor,
  resetDeliveryForRedelivery,
  type DeliveryView,
} from "@qcms/db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { deadLettersRoute, deliveriesRoute, redeliverRoute } from "./route.js";
import { isDeliveryId } from "./schema.js";

const fail = {
  deliveryNotFound: (): ApiError =>
    new ApiError("DELIVERY_NOT_FOUND", 404, "No such webhook delivery"),
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  // One refusal for every way a delivery can be unsendable (059, issue #329). A
  // cancelled delivery and a redacted payload are the same fact seen from two rows -
  // the response this delivery carries is no longer held - so splitting them into
  // two codes would make the client distinguish something it cannot act on
  // differently.
  //
  // **Cause-free, and renamed from 035's `DELIVERY_SESSION_ERASED` because of it.**
  // That code and its sentence were accurate while erasure was the only producer of
  // `payload_redacted_at`. Issue #329's retention sweep is a second producer, so
  // both would now tell an operator a response was erased when it merely aged out of
  // the redelivery window. The two causes are indistinguishable from the delivery
  // row by design - `redeliveryRefusalFor` is a statement about state, not cause,
  // which is what keeps it identical to the scheduler's filter - so the honest
  // answer names the state. A stable code that is false is worse than a renamed one:
  // this is a 409 the admin maps to a sentence, and the admin is its only client.
  notRedeliverable: (): ApiError =>
    new ApiError(
      "DELIVERY_NOT_REDELIVERABLE",
      409,
      "The response this delivery carries is no longer held, so it will not be re-sent",
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
          // The worklist is cross-form, and redelivery is form-scoped, so each row
          // carries the form needed to act on it (#305).
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

// --- GET /admin/forms/:id/deliveries ----------------------------------------

/**
 * The delivery status, derived from the lifecycle timestamps rather than stored.
 *
 * Order matters: a delivered row can also carry a `deadLetteredAt` from an earlier
 * life if it was redelivered after dead-lettering (the reset clears it, but a future
 * caller of `markDeliveryDelivered` need not), so "delivered" is checked first and
 * the most recent outcome wins.
 *
 * `cancelled` (059) sits second, above `deadLettered`, for the same reason: erasure
 * cancels dead-lettered rows too, and cancellation is the later and terminal fact.
 * It sits *below* `delivered` because erasure never cancels a delivered row - that
 * event has already left, and saying otherwise on the dashboard would be a fiction.
 */
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

// --- POST /admin/forms/:id/deliveries/:deliveryId/redeliver -----------------

export function makeRedeliverHandler(deps: Deps): RouteHandler<typeof redeliverRoute, ApiEnv> {
  return async (c) => {
    const { id, deliveryId } = c.req.valid("param");

    // Form scope (#305). The form segment is not decorative: it is threaded into
    // both delivery queries below, each of which filters through
    // `webhooks.form_id`, so a delivery belonging to another form matches no row
    // and comes back 404 - indistinguishable from an id that was never issued.
    //
    // No `getForm` existence check here, deliberately. An unknown form makes the
    // scoped queries match nothing, which is already the right 404, and asking
    // separately would answer "does this form exist" for a caller who cannot
    // otherwise tell. The malformed-id 400 below is a grammar fact, not existence.
    const parsed = parseFormId(id);
    if (!parsed.ok) throw fail.invalidId();
    const formId = parsed.value;

    // Issue 310: a delivery id is a uuid, and `webhook_deliveries.id` is a `uuid`
    // column, so a malformed id used to reach Postgres and raise `22P02 invalid
    // input syntax for type uuid` - a 500 for what is a client's bad id. It takes
    // the same 404 an absent row takes rather than a 400 of its own: both are "no
    // such delivery" to the caller, the route documents no 400, and one code keeps
    // the admin dashboard's existing DELIVERY_NOT_FOUND handling correct. The check
    // sits here rather than on the param schema because a schema rejection is a 400.
    if (!isDeliveryId(deliveryId)) throw fail.deliveryNotFound();

    // ADR-17 (as amended 2026-08-02): refuse before resetting. Erasure cancels the
    // session's still-sendable deliveries and redacts the outbox payload they would
    // carry, the retention sweep redacts a settled payload once its redelivery
    // window closes (issue #329), and `redeliveryRefusalFor` reads exactly the two
    // columns `claimDueDeliveries` filters on - one rule, stated in the two places
    // it has to hold, rather than 035's separate tombstone lookup that could drift
    // from the scheduler's behaviour. Resetting anyway would put a row that can
    // never be claimed back on the queue as "pending", which is a lie on the
    // dashboard even though the answers could not actually go out. Bulk redelivery
    // is this endpoint called per item, so it is covered by construction.
    // Both calls are form-scoped, and both have to be (#305). This one runs first,
    // so an unscoped read here would answer 409 for another form's cancelled or
    // redacted delivery where an unknown id answers 404 - a difference that reports
    // someone else's row exists. Scoped, it returns undefined and the reset below
    // produces the ordinary 404.
    if ((await redeliveryRefusalFor(deps.db, formId, deliveryId)) !== undefined) {
      throw fail.notRedeliverable();
    }

    const reset = await resetDeliveryForRedelivery(deps.db, formId, deliveryId, deps.clock.now());
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
