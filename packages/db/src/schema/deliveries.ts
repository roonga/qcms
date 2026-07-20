import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { outbox } from "./outbox.js";
import { webhooks } from "./webhooks.js";

/**
 * Per-(event, webhook) delivery state (`ARCHITECTURE.md` §5.3; task 025).
 *
 * The `outbox` row is a single domain event; a `response.submitted` event fans
 * out to every `active` webhook a form has. Each fan-out target needs its **own**
 * independent retry/backoff/dead-letter state - one webhook failing must not stall
 * or dead-letter the others - so the unit of *delivery* is this row, not the
 * outbox row. The deliverer's two-phase pass:
 *
 *  1. **materialize** - claim a due outbox event (`FOR UPDATE SKIP LOCKED`),
 *     insert one `webhook_deliveries` row per active webhook (idempotent via the
 *     `(outbox_id, webhook_id)` unique key), then mark the outbox row consumed.
 *  2. **deliver** - claim a due, live delivery row (`FOR UPDATE SKIP LOCKED`),
 *     POST the signed request, and record the outcome on *this* row.
 *
 * The lifecycle columns mirror `outbox` deliberately (attempts / next_attempt_at
 * / delivered_at / dead_lettered_at / last_error) and share the same backoff math
 * (`computeBackoff`), so the derived status - pending, delivered, dead-lettered -
 * is a function of the timestamps, never a redundant stored enum that could drift.
 * At-least-once, never best-effort (a crash between POST and `delivered_at` rolls
 * back and the row is redelivered).
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The outbox event being fanned out. */
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => outbox.id),
    /** The webhook endpoint this row delivers to. */
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.webhookId),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotent materialization: one delivery per (event, webhook). A second
    // materialize pass (or a concurrent deliverer) cannot double-fan-out.
    unique("webhook_deliveries_event_webhook_uq").on(t.outboxId, t.webhookId),
    // The deliverer's claim query: undelivered, live (not dead-lettered) rows due
    // for an attempt. Partial index keeps it tight as history accumulates.
    index("webhook_deliveries_due_idx")
      .on(t.deliveredAt, t.nextAttemptAt)
      .where(sql`${t.deadLetteredAt} is null`),
  ],
);
