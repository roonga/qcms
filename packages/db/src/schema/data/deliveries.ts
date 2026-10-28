import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { outbox } from "./outbox.js";
import { webhooks } from "./webhooks.js";

/**
 * Per-(event, webhook) delivery state: one outbox event fans out to every `active` webhook, each with its own
 * retry and dead-letter state. The signature never lands here: `last_request_headers` is stored with
 * `x-qcms-signature` already masked, so the HMAC is absent from the database (SEC-6, SEC-13).
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => outbox.id),
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
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "date" }),
    /** Null when the attempt never got a response: timeout, network, SSRF, decrypt. */
    lastStatus: integer("last_status"),
    lastLatencyMs: integer("last_latency_ms"),
    lastRequestHeaders: jsonb("last_request_headers").$type<Record<string, string>>(),
    /**
     * The one column here that can hold respondent content, because a consumer may echo
     * the request back, so it has its own retention: erasure and the retention sweep both
     * clear it and stamp {@link lastResponseSnippetRedactedAt}.
     */
    lastResponseSnippet: text("last_response_snippet"),
    /**
     * Distinguishes a removed body from a response that never arrived, an empty body or a
     * row reset for redelivery. Cause-free, because erasure and the retention sweep both
     * write it.
     */
    lastResponseSnippetRedactedAt: timestamp("last_response_snippet_redacted_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /**
     * Terminally cancelled and never to be attempted again (ADR-17). Deliberately not
     * `dead_lettered_at`, which is offered back for redelivery.
     */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    /** A closed value-free code, never respondent data. */
    cancelledReason: text("cancelled_reason"),
  },
  (t) => [
    // One delivery per (event, webhook), so a repeated materialize pass cannot
    // double-fan-out.
    unique("webhook_deliveries_event_webhook_uq").on(t.outboxId, t.webhookId),
    index("webhook_deliveries_due_idx")
      .on(t.deliveredAt, t.nextAttemptAt)
      .where(sql`${t.deadLetteredAt} is null`),
    // The partial predicate is what makes the planner choose this at all: without it the
    // index cannot exclude rows the sweep has already redacted, so a sequential scan wins.
    index("webhook_deliveries_snippet_retention_idx")
      .on(t.lastAttemptAt)
      .where(sql`${t.lastResponseSnippet} is not null`),
    // Without an attempt time the sweep's `last_attempt_at < horizon` is never true, so a
    // row holding a snippet would escape every sweep forever.
    check(
      "webhook_deliveries_snippet_requires_attempt",
      sql`${t.lastResponseSnippet} is null or ${t.lastAttemptAt} is not null`,
    ),
  ],
);
