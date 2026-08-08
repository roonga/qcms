import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
 *
 * ## The `last_*` attempt record (task 035)
 *
 * The operator dashboard 035 renders has to answer "what actually went over the
 * wire, and what came back" - status, latency, request headers, a response body
 * snippet. None of that is derivable from the lifecycle columns above, and a screen
 * that described the request from the deliverer's *intent* rather than from what it
 * sent would be a fiction the moment either side changed. So the deliverer records
 * the most recent attempt here, on the row, and the dashboard reads only this.
 *
 * Last attempt, not every attempt: a per-attempt history table is unbounded growth
 * for a screen whose question is "why is this one stuck", and `attempts` +
 * `last_error` already carry the shape of the history. A full attempt log is a
 * Phase-4 refinement if operators ask for it.
 *
 * **The signature never lands here.** `last_request_headers` stores the header map
 * as sent with `x-qcms-signature` already replaced by a mask, so the HMAC is absent
 * from the database rather than merely hidden by a renderer (SEC-6, SEC-13). The
 * webhook secret is not in the header set at all.
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
    /** When the most recent attempt was made (null until one has been). */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "date" }),
    /**
     * The HTTP status the most recent attempt got back, or null when it never got
     * one (timeout, network error, SSRF rejection, secret decrypt failure).
     */
    lastStatus: integer("last_status"),
    /** Wall-clock duration of the most recent attempt, in milliseconds. */
    lastLatencyMs: integer("last_latency_ms"),
    /** The headers as sent, with the signature masked before storage. */
    lastRequestHeaders: jsonb("last_request_headers").$type<Record<string, string>>(),
    /**
     * A bounded prefix of the most recent response body (diagnostics).
     *
     * **The one column on this table that can hold respondent content.** It is a
     * consumer's bytes, verbatim, and consumers commonly echo the request back in a
     * validation error - so an answer the respondent typed can land here without
     * QCMS ever choosing to write it. That is why it has a retention story of its
     * own (issue #304): erasure clears it on request and the retention sweep ages it
     * out, both stamping {@link lastResponseSnippetRedactedAt}. Everything else in
     * the attempt record (`last_status`, `last_latency_ms`, `last_error`, the masked
     * headers) is structurally value-free and is kept forever.
     */
    lastResponseSnippet: text("last_response_snippet"),
    /**
     * When the stored response snippet was removed, and null while it is intact
     * (issue #304). It distinguishes "this attempt's body is gone because we removed
     * it" from the three ways `last_response_snippet` was *already* null: no response
     * ever arrived, the consumer answered with an empty body, or the row was reset
     * for redelivery. Without it the dashboard would tell an operator the body was
     * empty when in fact it was redacted.
     *
     * Deliberately **cause-free**. It has two producers - erasure and the retention
     * sweep - and a marker that named one of them would be a false statement the
     * moment the other wrote it. Where the cause matters it is already on the row:
     * an erased session's undelivered deliveries carry `cancelled_reason`, and its
     * outbox parent carries `payload_redacted_at`.
     */
    lastResponseSnippetRedactedAt: timestamp("last_response_snippet_redacted_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /**
     * When this delivery was terminally cancelled and will never be attempted again
     * (ADR-17 as amended 2026-08-02, task 059). Null on every live delivery.
     *
     * Deliberately **not** `dead_lettered_at`. A dead letter means retries were
     * exhausted and the dead-letter queue offers the row back for redelivery, which
     * is the opposite of what this state means: a cancelled delivery is one nobody
     * may ever send, so it is excluded from the claim query and from the dead-letter
     * queue, and the redeliver endpoint refuses it. Reusing the dead-letter column
     * would have made "offer this for redelivery" and "never send this" the same
     * value.
     *
     * The row itself survives. It plus its outbox parent are the audit record of
     * what did and did not leave the building, and the dashboard shows the state
     * rather than dropping the row: an operator asking "what happened to that
     * delivery" must find the answer.
     */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    /**
     * Why the delivery was cancelled: a closed value-free code, never respondent
     * data. Today the only producer is erasure
     * ({@link ../queries/deliveries.js#DELIVERY_CANCELLED_SESSION_ERASED}); it is a
     * text column rather than an enum so a later cancellation cause (the retention
     * sweep of issue #329, say) does not need a migration on this table.
     */
    cancelledReason: text("cancelled_reason"),
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
