// The secret is show-once (SEC-6): it may appear only in a create or rotate response,
// never in a listing or detail read.

import { z } from "@hono/zod-openapi";

export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

export const WebhookParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  webhookId: z
    .string()
    .openapi({ param: { name: "webhookId", in: "path" }, example: "whk_ab12cd34" }),
});

export const CreateWebhookBody = z
  .strictObject({
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    secret: z.string().min(16).optional().openapi({ example: "whsec_…" }),
    active: z.boolean().default(true).openapi({ example: true }),
  })
  .openapi("CreateWebhookBody");

export const UpdateWebhookBody = z
  .strictObject({
    url: z.string().optional().openapi({ example: "https://consumer.example.com/qcms-hook-v2" }),
    active: z.boolean().optional().openapi({ example: false }),
    rotateSecret: z.boolean().optional().openapi({ example: true }),
    // An explicit value implies rotation.
    secret: z.string().min(16).optional().openapi({ example: "whsec_…" }),
  })
  .openapi("UpdateWebhookBody");

export const WebhookSummary = z
  .object({
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    url: z.string().openapi({
      description:
        "The endpoint URL. A caller holding only forms.viewer sees the query string " +
        "replaced by (hidden); forms.editor and above see the whole URL. Do not put " +
        "credentials in an endpoint URL: use the signing secret.",
      example: "https://consumer.example.com/qcms-hook",
    }),
    active: z.boolean().openapi({ example: true }),
    hasSecret: z.literal(true).openapi({ example: true }),
    deactivatedAt: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("WebhookSummary");

export const CreatedWebhookResponse = z
  .object({
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    active: z.boolean().openapi({ example: true }),
    // The only response that carries the plaintext; every later read omits it.
    secret: z.string().openapi({ example: "whsec_…" }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("CreatedWebhookResponse");

export const WebhookListResponse = z
  .object({ webhooks: z.array(WebhookSummary) })
  .openapi("WebhookListResponse");

// `secret` is present only when this call rotated it.
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

export const DeactivatedWebhookResponse = z
  .object({
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    active: z.literal(false).openapi({ example: false }),
    deactivatedAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("DeactivatedWebhookResponse");

export const EndpointProposalParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  proposalId: z
    .string()
    .openapi({ param: { name: "proposalId", in: "path" }, example: "wep_ab12cd34" }),
});

// The rule is two distinct accounts, not two roles: one person may hold both
// `forms.editor` and `forms.approver`. A null `appliedAt` means not live, because the
// proposal and the endpoint commit on different pools.
export const EndpointProposal = z
  .object({
    proposalId: z.string().openapi({ example: "wep_ab12cd34" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    environment: z.string().openapi({ example: "prod" }),
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    kind: z.enum(["create", "update", "deactivate"]).openapi({ example: "update" }),
    // Masked for a `forms.viewer` exactly as the endpoint read is (Q58).
    url: z.string().nullable().openapi({ example: "https://consumer.example.com/qcms-hook-v2" }),
    active: z.boolean().nullable().openapi({ example: true }),
    rotatesSecret: z.boolean().openapi({ example: false }),
    proposedBy: z.string().openapi({ example: "usr_alice" }),
    proposedAt: z.string().openapi({ example: "2026-10-22T00:00:00.000Z" }),
    confirmedBy: z.string().nullable().openapi({ example: null }),
    confirmedAt: z.string().nullable().openapi({ example: null }),
    appliedAt: z.string().nullable().openapi({ example: null }),
  })
  .openapi("EndpointProposal");

// A 202 body on the configure route rather than a separate propose route, so a client
// cannot guess wrong and configure production without a second account.
export const PendingEndpointChangeResponse = z
  .object({
    pending: z.literal(true).openapi({ example: true }),
    proposal: EndpointProposal,
    // Shown at propose time because this is the only moment the plaintext exists (SEC-6).
    secret: z.string().optional().openapi({ example: "whsec_…" }),
  })
  .openapi("PendingEndpointChangeResponse");

export const EndpointProposalListResponse = z
  .object({ proposals: z.array(EndpointProposal) })
  .openapi("EndpointProposalListResponse");

export const EndpointProposalResponse = z
  .object({ proposal: EndpointProposal })
  .openapi("EndpointProposalResponse");
