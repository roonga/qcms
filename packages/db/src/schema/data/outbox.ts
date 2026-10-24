import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The transactional outbox: an event is written in the same transaction as the state
 * change it describes, then delivered with backoff. At-least-once, never best-effort.
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
     * A submitted response's payload is QCMS's own copy of what erasure must remove, so
     * redaction drops `answers` and stamps this (ADR-17). The claim queries filter on it,
     * so a redacted payload has no path to the transport. It is a column rather than a
     * payload-shape test because `jsonb_exists(payload, 'answers')` is also false for
     * every event type that never carried answers.
     */
    payloadRedactedAt: timestamp("payload_redacted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("outbox_delivery_idx")
      .on(t.deliveredAt, t.nextAttemptAt)
      .where(sql`${t.deadLetteredAt} is null`),
    // Both halves are needed: the sweep ages on an expression `outbox_delivery_idx` cannot
    // serve, and without the partial predicate the planner never chooses the index, because
    // it cannot exclude rows already redacted. `jsonb_exists` is immutable, so it is legal
    // in a predicate.
    index("outbox_payload_retention_idx")
      .on(sql`greatest(${t.deliveredAt}, ${t.deadLetteredAt})`)
      .where(sql`${t.payloadRedactedAt} is null and jsonb_exists(${t.payload}, 'answers')`),
    // Every claim query and the sweep read the marker as proof the answers are gone, so a
    // writer that stamped it without dropping `answers` would leave the whole answer set in
    // a row nothing looks at again.
    check(
      "outbox_redacted_payload_has_no_answers",
      sql`${t.payloadRedactedAt} is null or not jsonb_exists(${t.payload}, 'answers')`,
    ),
  ],
);
