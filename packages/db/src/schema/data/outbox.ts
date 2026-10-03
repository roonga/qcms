import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
     * When the `answers` member was removed from this row's payload, and null while
     * it is intact (ADR-17 as amended 2026-08-02, task 059; issue #329).
     *
     * `outbox.payload` carries a submitted response's **whole locked answer set**,
     * so it is QCMS's own retained copy of exactly what erasure is asked to remove.
     * A redaction rewrites the payload in place - envelope kept (`sessionId`,
     * `formId`, `formVersion`, `submittedAt`, `contentHash`), `answers` dropped -
     * and stamps this column. Existence without content, the same principle the
     * tombstone applies one table over.
     *
     * Deliberately **cause-free**, like `webhook_deliveries.last_response_snippet_
     * redacted_at`. It has two producers - erasure on request (`eraseSession`) and
     * the retention sweep once the redelivery window has closed
     * (`redactAgedOutboxPayloads`, issue #329) - and a marker that named one of them
     * would be a false statement the moment the other wrote it. Where the cause
     * matters it is on other rows: an erased session has a tombstone, and its
     * still-sendable deliveries carry `cancelled_reason`.
     *
     * The column exists so the redacted state is **queryable** rather than inferred
     * from the payload's shape: `jsonb_exists(payload, 'answers')` is false for any
     * event type that never had answers, which would make "was this redacted?"
     * unanswerable. The claim queries filter on this column, so a redacted payload
     * has no path to the transport whatever a future caller does.
     */
    payloadRedactedAt: timestamp("payload_redacted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    // The deliverer's claim query: undelivered, live (not dead-lettered) rows due
    // for a delivery attempt. Partial index keeps it tight as the table grows.
    index("outbox_delivery_idx")
      .on(t.deliveredAt, t.nextAttemptAt)
      .where(sql`${t.deadLetteredAt} is null`),
    // The payload retention sweep's scan (`redactAgedOutboxPayloads`, issue #329),
    // added on the measurement in issue #434.
    //
    // Both halves are needed and neither is sufficient alone. The sweep ages on
    // `greatest(delivered_at, dead_lettered_at)`, an expression over two columns
    // that `outbox_delivery_idx` cannot serve; but a bare expression index was
    // measured too, and the planner never chose it at any scale, for the same
    // reason as its counterpart on `webhook_deliveries` - without the partial
    // predicate it cannot exclude rows already redacted, so the row estimate stays
    // near the table size and a sequential scan wins. The predicate mirrors the
    // sweep's own filters exactly, which is also what keeps the index small: it
    // covers only rows that still hold answers, so it shrinks as the sweep works.
    //
    // Measured on Postgres 16 with a 1M-row outbox (2.1 GB): the outbox side of
    // the plan drops from 246,668 blocks to 63. Steady-state size 3.5 MB, peaking
    // at 21 MB against a full backlog, and about 21 microseconds of index
    // maintenance per insert - invisible against the ~4 ms durable commit, on a
    // path that writes one row per submission. The write-amplification worry issue
    // #434 raises is real for a bulk load and does not survive contact with the
    // write path QCMS actually has.
    //
    // **This removes the outbox scan; it does not make the sweep cheap.** The
    // correlated NOT EXISTS still hash-anti-joins the whole `webhook_deliveries`
    // table (150 ms of the remaining 182 ms at 1M rows), and no index fixes it: a
    // forced nested loop reaches 12 ms using the EXISTING
    // `webhook_deliveries_event_webhook_uq`, so what is left is a planner
    // cost-model choice. Closing that means restructuring the query or bounding
    // the sweep, which is a query decision rather than a schema one.
    //
    // `jsonb_exists` is immutable, so it is legal in an index predicate.
    index("outbox_payload_retention_idx")
      .on(sql`greatest(${t.deliveredAt}, ${t.deadLetteredAt})`)
      .where(sql`${t.payloadRedactedAt} is null and jsonb_exists(${t.payload}, 'answers')`),
    // The marker means the answers are gone (issue #329).
    //
    // Both redaction paths write the two together in one UPDATE, and both the claim
    // queries and the retention sweep read the marker as proof of it: a row with the
    // marker set is excluded from `claimDue`, from `claimDueDeliveries`, from
    // redelivery, and from every future sweep. So a writer that stamped the marker
    // without dropping `answers` would produce a row holding the whole answer set
    // that nothing ever looks at again - invisible to the control by the control's
    // own predicate, which is the exact shape of the leak this column exists to
    // close. The pairing holds today by call-site convention, and a convention
    // cannot fail when a future writer breaks it; a CHECK constraint can. Same class
    // as issues #311 and #304.
    //
    // One direction only: a payload with no `answers` member and no marker is the
    // ordinary shape of every event type that never carried answers
    // (`form.published`), so it stays legal.
    check(
      "outbox_redacted_payload_has_no_answers",
      sql`${t.payloadRedactedAt} is null or not jsonb_exists(${t.payload}, 'answers')`,
    ),
  ],
);
