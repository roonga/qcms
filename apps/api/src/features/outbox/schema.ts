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

/**
 * The shape a `webhook_deliveries` row id can have: the canonical hyphenated uuid
 * Postgres returns for a `uuid` column.
 *
 * It matches that one spelling, case-insensitively, and nothing else. Stated
 * exactly, because it sits between two other grammars and is not equal to either:
 *
 * - **Wider than `z.uuid()` in the values it admits.** Zod's check is RFC 9562
 *   conformance, which additionally pins the version and variant nibbles: it
 *   rejects `aaaaaaaa-bbbb-1ccc-0ddd-eeeeeeeeeeee`, which the column stores
 *   happily. Pinning conformance here would turn a storable id into a "no such
 *   delivery", which is the defect class 310 is about, so it is not used.
 * - **Narrower than Postgres's input grammar in the spellings it admits.** A live
 *   `postgres:16-alpine` also accepts the unhyphenated form
 *   (`d290f1ee6c544b0190e6d701748f0851`), the braced form (`{d290f1ee-…}`), and
 *   arbitrary hyphen placement (`d290-f1ee-6c54-…`). Those are answered 404 here
 *   rather than looked up.
 *
 * The narrowing is deliberate, and it is the API's grammar rather than the
 * store's: delivery ids are machine values, minted by `gen_random_uuid()` and
 * round-tripped verbatim from the list responses that emit them, so the canonical
 * form is the only spelling any real caller holds. Accepting alternates would mean
 * one row answering to several ids on a surface whose whole job is to identify one
 * delivery. A caller that hand-writes an alternate spelling gets the same 404 as
 * any other unrecognized id, and `outbox.integration.test.ts` pins that on purpose
 * so it reads as a decision rather than an oversight.
 */
const DELIVERY_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `value` is a delivery id in the one spelling this API recognizes.
 *
 * A `true` guarantees a query on `value` cannot raise `22P02`. A `false` does not
 * mean Postgres would have rejected it (see the alternate spellings above); it
 * means this surface does not accept it as an id.
 */
export function isDeliveryId(value: string): boolean {
  return DELIVERY_ID_SHAPE.test(value);
}

/**
 * `:id` path param - a `webhook_deliveries` row id (uuid).
 *
 * The uuid shape is **not** enforced here, on purpose (issue 310). A param-schema
 * rejection is a 400, and this route documents 401/404/409 only: to a caller,
 * "that is not a delivery id" and "there is no delivery with that id" are the same
 * fact, and an admin surface has no reason to help distinguish them. So the handler
 * applies {@link isDeliveryId} and routes a malformed id into the same
 * `DELIVERY_NOT_FOUND` 404 an absent row already takes. Before 310 nothing checked
 * the shape at all and a non-uuid reached Postgres, which raised `22P02 invalid
 * input syntax for type uuid` and surfaced as a 500.
 */
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
 *
 * `cancelled` (059) is a delivery erasure terminally stopped: never attempted
 * again, refused by the redeliver endpoint, and excluded from the dead-letter
 * queue. The row is still listed here rather than hidden, because an operator
 * asking "what happened to that delivery" must find the answer.
 */
export const DeliveryStatus = z.enum(["delivered", "cancelled", "deadLettered", "pending"]);

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
    /** When erasure terminally cancelled this delivery (059); null on live rows. */
    cancelledAt: z.string().nullable().openapi({ example: null }),
    /** The value-free code naming why it was cancelled, e.g. `session_erased`. */
    cancelledReason: z.string().nullable().openapi({ example: null }),
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
