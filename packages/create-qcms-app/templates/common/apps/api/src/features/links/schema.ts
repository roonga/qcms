/**
 * Request/response schemas for the secure-link admin slices (task 024). Zod is
 * the single schema language (017); these drive both request validation and the
 * generated OpenAPI documents (027).
 *
 * A minted token appears in exactly one place - the returned link URL (the sole
 * deliberate case of a token in a URL, SEC-8, mitigated by expiry + the
 * `secure_links` row). The token itself is never persisted server-side; only the
 * link's state row is.
 */

import { z } from "@hono/zod-openapi";

/** The documented batch cap for a single mint request. */
export const MAX_LINK_BATCH = 100;

// --- params -----------------------------------------------------------------

/** `:id` path param - a `frm_…` form id (validated as a FormId in-handler). */
export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

/** `:linkId` path param - an `lnk_…` link id (validated in-handler). */
export const LinkIdParam = z.object({
  linkId: z.string().openapi({ param: { name: "linkId", in: "path" }, example: "lnk_ab12cd34" }),
});

// --- request bodies ---------------------------------------------------------

/**
 * `POST /admin/forms/:id/links` - mint one or a batch of secure links. `count`
 * defaults to 1 and is capped at {@link MAX_LINK_BATCH}. `expiresAt` is a future
 * ISO datetime (validated against the request clock in-handler).
 */
export const MintLinksBody = z
  .object({
    expiresAt: z.string().openapi({ example: "2026-12-31T23:59:59.000Z" }),
    oneTime: z.boolean().default(false).openapi({ example: true }),
    count: z.number().int().min(1).max(MAX_LINK_BATCH).default(1).openapi({ example: 1 }),
  })
  .openapi("MintLinksBody");

// --- responses --------------------------------------------------------------

/** One minted link: its id, the shareable URL (carrying the token), and expiry. */
export const MintedLink = z
  .object({
    linkId: z.string().openapi({ example: "lnk_ab12cd34" }),
    url: z.string().openapi({ example: "https://forms.example.com/l/eyJ…" }),
    expiresAt: z.string().openapi({ example: "2026-12-31T23:59:59.000Z" }),
  })
  .openapi("MintedLink");

export const MintLinksResponse = z
  .object({ links: z.array(MintedLink) })
  .openapi("MintLinksResponse");

/** A minted link's lifecycle state, derived from the row against the clock. */
export const LinkState = z.enum(["active", "consumed", "expired", "revoked"]);

/** A link in the listing, with derived state and consumption/revocation stamps. */
export const LinkListItem = z
  .object({
    linkId: z.string().openapi({ example: "lnk_ab12cd34" }),
    state: LinkState.openapi({ example: "active" }),
    oneTime: z.boolean().openapi({ example: true }),
    expiresAt: z.string().openapi({ example: "2026-12-31T23:59:59.000Z" }),
    consumedAt: z.string().nullable().openapi({ example: null }),
    revokedAt: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("LinkListItem");

export const LinkListResponse = z
  .object({ links: z.array(LinkListItem) })
  .openapi("LinkListResponse");

/** Revoke response. */
export const RevokedLinkResponse = z
  .object({
    linkId: z.string().openapi({ example: "lnk_ab12cd34" }),
    state: z.literal("revoked").openapi({ example: "revoked" }),
    revokedAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("RevokedLinkResponse");
