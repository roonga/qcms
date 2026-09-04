/**
 * Request/response schemas for the webhook-config admin slices (task 024). Zod
 * is the single schema language (017); these drive both request validation and
 * the generated OpenAPI documents (027).
 *
 * The webhook **secret** is write-once / show-once (SEC-6): it appears in a
 * response body ONLY on create and on an explicit rotate, and is never present
 * in a listing or detail read (masked). The stored ciphertext never leaves the
 * server (it is not modelled here at all).
 */

import { z } from "@hono/zod-openapi";

// --- params -----------------------------------------------------------------

/** `:id` path param - a `frm_…` form id (validated as a FormId in-handler). */
export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

/** `:id`/`:webhookId` path params for per-webhook mutations. */
export const WebhookParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  webhookId: z
    .string()
    .openapi({ param: { name: "webhookId", in: "path" }, example: "whk_ab12cd34" }),
});

// --- request bodies ---------------------------------------------------------

/** `POST /admin/forms/:id/webhooks` - configure a webhook. */
export const CreateWebhookBody = z
  .object({
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    /** Optional caller-supplied secret; generated server-side when omitted. */
    secret: z.string().min(16).optional().openapi({ example: "whsec_…" }),
    active: z.boolean().default(true).openapi({ example: true }),
  })
  .openapi("CreateWebhookBody");

/** `PUT /admin/forms/:id/webhooks/:webhookId` - update url/active, rotate secret. */
export const UpdateWebhookBody = z
  .object({
    url: z.string().optional().openapi({ example: "https://consumer.example.com/qcms-hook-v2" }),
    active: z.boolean().optional().openapi({ example: false }),
    /** Rotate the secret to a fresh server-generated value (shown once). */
    rotateSecret: z.boolean().optional().openapi({ example: true }),
    /** Rotate the secret to this explicit value (shown once). Implies rotation. */
    secret: z.string().min(16).optional().openapi({ example: "whsec_…" }),
  })
  .openapi("UpdateWebhookBody");

// --- responses --------------------------------------------------------------

/** A webhook in a listing/detail - the secret is masked (never included). */
export const WebhookSummary = z
  .object({
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    active: z.boolean().openapi({ example: true }),
    /** True once a secret is configured; the value itself is never returned. */
    hasSecret: z.literal(true).openapi({ example: true }),
    deactivatedAt: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("WebhookSummary");

/** Create response: the summary plus the one-time-visible plaintext secret. */
export const CreatedWebhookResponse = z
  .object({
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    active: z.boolean().openapi({ example: true }),
    /** Shown exactly once, here. Store it now - it is masked on every later read. */
    secret: z.string().openapi({ example: "whsec_…" }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("CreatedWebhookResponse");

/** List response. */
export const WebhookListResponse = z
  .object({ webhooks: z.array(WebhookSummary) })
  .openapi("WebhookListResponse");

/**
 * Update response: the summary, plus a `secret` present **only** when this call
 * rotated it (shown once). Absent when the update did not touch the secret.
 */
export const UpdatedWebhookResponse = z
  .object({
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook-v2" }),
    active: z.boolean().openapi({ example: true }),
    deactivatedAt: z.string().nullable().openapi({ example: null }),
    updatedAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
    secret: z.string().optional().openapi({ example: "whsec_…" }),
  })
  .openapi("UpdatedWebhookResponse");

/** Soft-deactivate response. */
export const DeactivatedWebhookResponse = z
  .object({
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    active: z.literal(false).openapi({ example: false }),
    deactivatedAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("DeactivatedWebhookResponse");
