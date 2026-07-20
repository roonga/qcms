/**
 * Outbox delivery-operations admin handlers (task 025).
 *
 * Two operator actions over the dead-letter surface (§5.3, ARCHITECTURE §10):
 * list dead-lettered deliveries with their attempt history, and manually redeliver
 * one (reset it to due-now so the next pass re-attempts it). Honest transaction
 * scripts (R5) over the `@qcms/db` delivery helpers — no cross-row invariant, no
 * signing/HTTP here (that is the delivery pass). Fetch-pure (R4): time via
 * `deps.clock`, no `node:*`.
 *
 * SEC-8: responses carry ids, urls, event types, attempt counts, and value-free
 * error codes only — never a secret, a payload, or an answer value.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { listDeadLetterDeliveries, resetDeliveryForRedelivery } from "@qcms/db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { deadLettersRoute, redeliverRoute } from "./route.js";

const fail = {
  deliveryNotFound: (): ApiError =>
    new ApiError("DELIVERY_NOT_FOUND", 404, "No such webhook delivery"),
} as const;

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

// --- POST /admin/outbox/:id/redeliver ---------------------------------------

export function makeRedeliverHandler(deps: Deps): RouteHandler<typeof redeliverRoute, ApiEnv> {
  return async (c) => {
    const { id } = c.req.valid("param");
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
