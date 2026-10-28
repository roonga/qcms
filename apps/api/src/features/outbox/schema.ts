import { z } from "@hono/zod-openapi";

// Deliberately not `z.uuid()`, which pins the RFC 9562 version and variant nibbles and
// would turn an id the column stores happily into a "no such delivery". Also narrower
// than Postgres's own input grammar, which accepts unhyphenated, braced and
// arbitrarily-hyphenated spellings: those get a 404 rather than one row answering to
// several ids.
const DELIVERY_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// True guarantees a query on `value` cannot raise `22P02`.
export function isDeliveryId(value: string): boolean {
  return DELIVERY_ID_SHAPE.test(value);
}

// The uuid shape is not enforced here on purpose: a param-schema rejection is a 400, and
// this route documents 401/404/409 only. The handler applies `isDeliveryId` instead, so a
// malformed id takes the same 404 an absent row takes.
export const FormDeliveryParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  deliveryId: z.string().openapi({
    param: { name: "deliveryId", in: "path" },
    example: "d290f1ee-6c54-4b01-90e6-d701748f0851",
  }),
});

export const DeadLetterItem = z
  .object({
    deliveryId: z.string().openapi({ example: "d290f1ee-6c54-4b01-90e6-d701748f0851" }),
    eventId: z.string().openapi({ example: "a1b2c3d4-0000-0000-0000-000000000000" }),
    eventType: z.string().openapi({ example: "response.submitted" }),
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    // The worklist is cross-form and redelivery is form-scoped, so a row has to name its
    // own form for a client to build a redeliver call.
    formId: z.string().openapi({ example: "frm_intake" }),
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    attempts: z.number().int().openapi({ example: 10 }),
    // A value-free code or status only: never a secret or an answer value.
    lastError: z.string().nullable().openapi({ example: "http_500" }),
    deadLetteredAt: z.string().nullable().openapi({ example: "2026-07-20T02:00:00.000Z" }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("DeadLetterDelivery");

export const DeadLettersResponse = z
  .object({ deadLetters: z.array(DeadLetterItem) })
  .openapi("DeadLettersResponse");

export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

export const DeliveriesQuery = z.object({
  limit: z
    .string()
    .optional()
    .openapi({ param: { name: "limit", in: "query" }, example: "50" }),
});

// A `cancelled` row is still listed rather than hidden, so an operator asking what
// happened to a delivery finds the answer.
export const DeliveryStatus = z.enum(["delivered", "cancelled", "deadLettered", "pending"]);

// `requestHeaders` carries the HMAC already replaced: the deliverer masks it before
// storage, so the signature is absent from the database, not just from this response
// (SEC-6, SEC-13). `attempts` counts failed attempts, so a first-time success is 0.
export const DeliveryItem = z
  .object({
    deliveryId: z.string().openapi({ example: "d290f1ee-6c54-4b01-90e6-d701748f0851" }),
    eventId: z.string().openapi({ example: "a1b2c3d4-0000-0000-0000-000000000000" }),
    eventType: z.string().openapi({ example: "response.submitted" }),
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    url: z.string().openapi({
      description:
        "The endpoint URL. A caller holding only forms.viewer sees the query string " +
        "replaced by (hidden); forms.editor and above see the whole URL.",
      example: "https://consumer.example.com/qcms-hook",
    }),
    status: DeliveryStatus,
    attempts: z.number().int().openapi({ example: 2 }),
    lastError: z.string().nullable().openapi({ example: "http_500" }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
    deliveredAt: z.string().nullable().openapi({ example: null }),
    deadLetteredAt: z.string().nullable().openapi({ example: null }),
    cancelledAt: z.string().nullable().openapi({ example: null }),
    // A value-free code only, such as `session_erased`.
    cancelledReason: z.string().nullable().openapi({ example: null }),
    nextAttemptAt: z.string().openapi({ example: "2026-07-20T00:01:00.000Z" }),
    lastAttemptAt: z.string().nullable().openapi({ example: "2026-07-20T00:00:03.000Z" }),
    // Null when the attempt never got a response at all.
    lastStatus: z.number().int().nullable().openapi({ example: 500 }),
    latencyMs: z.number().int().nullable().openapi({ example: 42 }),
    requestHeaders: z.record(z.string(), z.string()).nullable(),
    responseSnippet: z.string().nullable().openapi({ example: "upstream unavailable" }),
    // Without this a client cannot tell a removed body from the three other ways
    // `responseSnippet` is null: no response arrived, the body was empty, or the row was
    // reset for redelivery.
    responseSnippetRedactedAt: z.string().nullable().openapi({ example: null }),
  })
  .openapi("DeliveryItem");

export const DeliveriesResponse = z
  .object({ deliveries: z.array(DeliveryItem) })
  .openapi("DeliveriesResponse");

export const RedeliverResponse = z
  .object({
    deliveryId: z.string().openapi({ example: "d290f1ee-6c54-4b01-90e6-d701748f0851" }),
    status: z.literal("pending").openapi({ example: "pending" }),
    attempts: z.literal(0).openapi({ example: 0 }),
    nextAttemptAt: z.string().openapi({ example: "2026-07-20T02:05:00.000Z" }),
  })
  .openapi("RedeliverResponse");
