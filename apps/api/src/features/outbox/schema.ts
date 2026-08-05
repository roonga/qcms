/**
 * Request/response schemas for the outbox delivery-operations admin slices
 * (task 025). Zod is the single schema language (017); these drive request
 * validation and the generated OpenAPI documents (027).
 *
 * These endpoints operate on the **per-(event, webhook) delivery** unit, not the
 * outbox event: a dead-letter is a single webhook endpoint that exhausted its
 * retries, and redelivery resets exactly that one delivery (its siblings for the
 * same event are untouched). The path lives under `/admin/outbox` for operator
 * familiarity, but `:id` is a delivery id.
 */

import { z } from "@hono/zod-openapi";

/** `:id` path param - a `webhook_deliveries` row id (uuid). */
export const DeliveryIdParam = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "d290f1ee-6c54-4b01-90e6-d701748f0851",
  }),
});

/** One dead-lettered delivery in the operator view (with attempt history). */
export const DeadLetterItem = z
  .object({
    deliveryId: z.string().openapi({ example: "d290f1ee-6c54-4b01-90e6-d701748f0851" }),
    /** The outbox event that fanned out to this delivery - an idempotency key. */
    eventId: z.string().openapi({ example: "a1b2c3d4-0000-0000-0000-000000000000" }),
    eventType: z.string().openapi({ example: "response.submitted" }),
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    attempts: z.number().int().openapi({ example: 10 }),
    /** The last failure reason (value-free code/status; never a secret or answer). */
    lastError: z.string().nullable().openapi({ example: "http_500" }),
    deadLetteredAt: z.string().nullable().openapi({ example: "2026-07-20T02:00:00.000Z" }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("DeadLetterDelivery");

/** `GET /admin/outbox/dead-letters` response. */
export const DeadLettersResponse = z
  .object({ deadLetters: z.array(DeadLetterItem) })
  .openapi("DeadLettersResponse");

/** `:id` path param on the form-scoped deliveries list - a `frm_…` form id. */
export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

/** `GET /admin/forms/:id/deliveries` query - how many rows of history to return. */
export const DeliveriesQuery = z.object({
  limit: z
    .string()
    .optional()
    .openapi({ param: { name: "limit", in: "query" }, example: "50" }),
});

/**
 * The derived delivery status. Never stored: it is a function of the lifecycle
 * timestamps (`deliveries.ts` explains why a stored enum could drift from them).
 */
export const DeliveryStatus = z.enum(["delivered", "deadLettered", "pending"]);

/**
 * One delivery in the operator dashboard (task 035), with the record of its most
 * recent attempt.
 *
 * `requestHeaders` is the header map as sent with the HMAC **already replaced** -
 * the deliverer masks it before storage, so the signature is absent from the
 * database, not merely from this response (SEC-6, SEC-13). `attempts` counts
 * *failed* attempts, which is what the retry schedule reads it as, so a first-time
 * success is `0`; the admin labels the column accordingly.
 */
export const DeliveryItem = z
  .object({
    deliveryId: z.string().openapi({ example: "d290f1ee-6c54-4b01-90e6-d701748f0851" }),
    eventId: z.string().openapi({ example: "a1b2c3d4-0000-0000-0000-000000000000" }),
    eventType: z.string().openapi({ example: "response.submitted" }),
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    status: DeliveryStatus,
    attempts: z.number().int().openapi({ example: 2 }),
    lastError: z.string().nullable().openapi({ example: "http_500" }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
    deliveredAt: z.string().nullable().openapi({ example: null }),
    deadLetteredAt: z.string().nullable().openapi({ example: null }),
    nextAttemptAt: z.string().openapi({ example: "2026-07-20T00:01:00.000Z" }),
    lastAttemptAt: z.string().nullable().openapi({ example: "2026-07-20T00:00:03.000Z" }),
    /** Null when the attempt never got a response (timeout, network error). */
    lastStatus: z.number().int().nullable().openapi({ example: 500 }),
    latencyMs: z.number().int().nullable().openapi({ example: 42 }),
    requestHeaders: z.record(z.string(), z.string()).nullable(),
    responseSnippet: z.string().nullable().openapi({ example: "upstream unavailable" }),
  })
  .openapi("DeliveryItem");

/** `GET /admin/forms/:id/deliveries` response. */
export const DeliveriesResponse = z
  .object({ deliveries: z.array(DeliveryItem) })
  .openapi("DeliveriesResponse");

/** `POST /admin/outbox/:id/redeliver` response - the reset delivery, now due. */
export const RedeliverResponse = z
  .object({
    deliveryId: z.string().openapi({ example: "d290f1ee-6c54-4b01-90e6-d701748f0851" }),
    status: z.literal("pending").openapi({ example: "pending" }),
    attempts: z.literal(0).openapi({ example: 0 }),
    nextAttemptAt: z.string().openapi({ example: "2026-07-20T02:05:00.000Z" }),
  })
  .openapi("RedeliverResponse");
