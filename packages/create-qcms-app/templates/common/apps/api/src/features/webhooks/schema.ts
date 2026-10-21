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
  .strictObject({
    url: z.string().openapi({ example: "https://consumer.example.com/qcms-hook" }),
    /** Optional caller-supplied secret; generated server-side when omitted. */
    secret: z.string().min(16).optional().openapi({ example: "whsec_…" }),
    active: z.boolean().default(true).openapi({ example: true }),
  })
  .openapi("CreateWebhookBody");

/** `PUT /admin/forms/:id/webhooks/:webhookId` - update url/active, rotate secret. */
export const UpdateWebhookBody = z
  .strictObject({
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
    /**
     * The endpoint's URL, with its **query string masked for a `forms.viewer`** and whole
     * for a `forms.editor` and above (Q58, task 067).
     *
     * The masking is the API's, in this response, never a client's rendering, so every
     * consumer of this route sees the same thing. The URL is not treated as a secret and
     * the signing secret is; masking a query string is a mitigation rather than a
     * control, which is why `docs/webhooks.md` and `docs/operations.md` tell operators not
     * to put a credential in an endpoint URL at all.
     */
    url: z.string().openapi({
      description:
        "The endpoint URL. A caller holding only forms.viewer sees the query string " +
        "replaced by (hidden); forms.editor and above see the whole URL. Do not put " +
        "credentials in an endpoint URL: use the signing secret.",
      example: "https://consumer.example.com/qcms-hook",
    }),
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

// --- the pending `prod` endpoint change (Q30, Q51; task 070) ----------------

/** `:id`/`:proposalId` path params for the confirm and the withdraw. */
export const EndpointProposalParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  proposalId: z
    .string()
    .openapi({ param: { name: "proposalId", in: "path" }, example: "wep_ab12cd34" }),
});

/**
 * One proposed endpoint change, pending a second approver (Q51, criterion 7).
 *
 * **It carries two accounts and no third thing**, which is the whole shape of the rule: the
 * account that proposed the change, and the account that confirmed it where one has. One
 * person may hold `forms.editor` and `forms.approver` together, so the rule is about two
 * accounts rather than two kinds of person, and this body is what a screen renders that
 * from.
 *
 * `appliedAt` is null while a confirmed change has not reached `data_<env>.webhooks` yet,
 * and a reader should treat that as **not live**: the proposal and the endpoint commit on
 * two different pools, so the window exists, and the conservative direction is the one this
 * mechanism takes - the endpoint is not live and the record says somebody confirmed.
 */
export const EndpointProposal = z
  .object({
    proposalId: z.string().openapi({ example: "wep_ab12cd34" }),
    formId: z.string().openapi({ example: "frm_intake" }),
    environment: z.string().openapi({ example: "prod" }),
    webhookId: z.string().openapi({ example: "whk_ab12cd34" }),
    kind: z.enum(["create", "update", "deactivate"]).openapi({ example: "update" }),
    /**
     * The proposed URL, or null where the act names none (a deactivation).
     *
     * **Masked for a `forms.viewer` exactly as the endpoint read is** (Q58): this route
     * hands a stored URL to a caller who may not be allowed to set it, which is the one
     * property that decides whether a URL is masked.
     */
    url: z.string().nullable().openapi({ example: "https://consumer.example.com/qcms-hook-v2" }),
    active: z.boolean().nullable().openapi({ example: true }),
    /** True when this change would set a new signing secret. The value is never returned. */
    rotatesSecret: z.boolean().openapi({ example: false }),
    proposedBy: z.string().openapi({ example: "usr_alice" }),
    proposedAt: z.string().openapi({ example: "2026-10-22T00:00:00.000Z" }),
    confirmedBy: z.string().nullable().openapi({ example: null }),
    confirmedAt: z.string().nullable().openapi({ example: null }),
    appliedAt: z.string().nullable().openapi({ example: null }),
  })
  .openapi("EndpointProposal");

/**
 * What a configure route answers when the two-person rule holds: the change is **stored
 * pending** and has taken effect on nothing.
 *
 * A `202` body rather than a route of its own, because the operator performed the same act
 * they always perform - "point this endpoint somewhere else" - and the answer is "stored,
 * waiting for a second approver" instead of "done". A separate propose route would make the
 * admin decide in advance which of the two it was about to do, and a client that guessed
 * wrong would configure production without a second account.
 */
export const PendingEndpointChangeResponse = z
  .object({
    pending: z.literal(true).openapi({ example: true }),
    proposal: EndpointProposal,
    /**
     * The new signing secret, shown **exactly once** here when this change sets one
     * (SEC-6), exactly as a create or a rotate that applied at once would show it.
     *
     * It is shown at propose time because this is the only moment the plaintext exists.
     * Nothing signs with it until the change is confirmed and applied, so a proposer holds
     * a secret that is not yet in use - which is the honest shape of a pending change and
     * is why the response says `pending`.
     */
    secret: z.string().optional().openapi({ example: "whsec_…" }),
  })
  .openapi("PendingEndpointChangeResponse");

/** `GET /admin/forms/:id/webhooks/proposals`: what is waiting, in the selected environment. */
export const EndpointProposalListResponse = z
  .object({ proposals: z.array(EndpointProposal) })
  .openapi("EndpointProposalListResponse");

/** `POST .../proposals/:proposalId/confirm` and `DELETE .../proposals/:proposalId`. */
export const EndpointProposalResponse = z
  .object({ proposal: EndpointProposal })
  .openapi("EndpointProposalResponse");
