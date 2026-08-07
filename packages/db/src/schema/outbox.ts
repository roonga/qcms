import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The transactional outbox (`ARCHITECTURE.md` §5.3). Domain events
 * (`response.submitted`, `form.published`) are written in the same transaction
 * as the state change they describe, then delivered by the background deliverer
 * with exponential backoff. After retries are exhausted a row is dead-lettered
 * (`dead_lettered_at` set) and surfaced in the admin UI for manual redelivery.
 * At-least-once, never best-effort.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    /**
     * When erasure removed the `answers` member from this row's payload (ADR-17 as
     * amended 2026-08-02, task 059). Null on every live event.
     *
     * `outbox.payload` carries a submitted response's **whole locked answer set**,
     * so it is QCMS's own retained copy of exactly what erasure is asked to remove.
     * `eraseSession` rewrites the payload in place - envelope kept (`sessionId`,
     * `formId`, `formVersion`, `submittedAt`, `contentHash`), `answers` dropped -
     * and stamps this column. Existence without content, the same principle the
     * tombstone applies one table over.
     *
     * The column exists so the redacted state is **queryable** rather than inferred
     * from the payload's shape: `payload ? 'answers'` is false for any event type
     * that never had answers, which would make "was this redacted?" unanswerable.
     * The claim queries filter on this column, so a redacted payload has no path to
     * the transport whatever a future caller does.
     */
    payloadRedactedAt: timestamp("payload_redacted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    // The deliverer's claim query: undelivered, live (not dead-lettered) rows due
    // for a delivery attempt. Partial index keeps it tight as the table grows.
    index("outbox_delivery_idx")
      .on(t.deliveredAt, t.nextAttemptAt)
      .where(sql`${t.deadLetteredAt} is null`),
  ],
);
