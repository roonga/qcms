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

/**
 * `:id` + `:linkId` path params for a link addressed within its form (#478).
 *
 * The form segment is not decorative: it is threaded into the revoke query's
 * `where` clause, so a link minted for another form matches no row and takes the
 * same 404 an unknown link takes.
 */
export const FormLinkParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  linkId: z.string().openapi({ param: { name: "linkId", in: "path" }, example: "lnk_ab12cd34" }),
});

// --- request bodies ---------------------------------------------------------

/**
 * `POST /admin/forms/:id/links` - mint one or a batch of secure links. `count`
 * defaults to 1 and is capped at {@link MAX_LINK_BATCH}. `expiresAt` is a future
 * ISO datetime (validated against the request clock in-handler).
 *
 * **`environment` is required and has no default** (Q19, task 066). A link belongs to
 * exactly one environment, the row decides which (Q46), and the reasoning for refusing a
 * default is precise: a script that omits the field and silently gets a **production**
 * link is the failure this rule exists to prevent. With request bodies already rejecting
 * unknown keys (#893) a caller has to be updated for the field either way, so there is
 * nothing to be gained by guessing for them. The admin takes it from the Q6 switcher.
 */
export const MintLinksBody = z
  .strictObject({
    environment: z
      .string()
      .min(1)
      .openapi({
        description:
          "The environment this link belongs to; one of the live set. Required, with no " +
          "default: a caller that omits it is refused (ADR-40, Q19).",
        example: "test",
      }),
    expiresAt: z.string().openapi({ example: "2026-12-31T23:59:59.000Z" }),
    oneTime: z.boolean().default(false).openapi({ example: true }),
    count: z.number().int().min(1).max(MAX_LINK_BATCH).default(1).openapi({ example: 1 }),
  })
  .openapi("MintLinksBody");

// --- responses --------------------------------------------------------------

/**
 * One minted link: its id, the shareable URL (carrying the token), its environment and
 * its expiry.
 *
 * **The URL carries the environment as its first path segment unless the environment is
 * `prod`** (Q21): a non-prod link reads `https://forms.example.com/test/l/eyJ…`, so it is
 * legible as non-production before anybody clicks it, and `prod` keeps exactly one
 * address shape so every link that exists keeps working. The environment is **not** in
 * the token - the path names it and the server-side row decides it.
 *
 * `environment` is echoed beside the URL so the admin's confirmation can restate it
 * (Q6) without parsing the address it is about to show.
 */
export const MintedLink = z
  .object({
    linkId: z.string().openapi({ example: "lnk_ab12cd34" }),
    environment: z.string().openapi({ example: "test" }),
    url: z.string().openapi({ example: "https://forms.example.com/test/l/eyJ…" }),
    expiresAt: z.string().openapi({ example: "2026-12-31T23:59:59.000Z" }),
  })
  .openapi("MintedLink");

export const MintLinksResponse = z
  .object({ links: z.array(MintedLink) })
  .openapi("MintLinksResponse");

/** A minted link's lifecycle state, derived from the row against the clock. */
export const LinkState = z.enum(["active", "consumed", "expired", "revoked"]);

/**
 * A link in the listing, with derived state and consumption/revocation stamps.
 *
 * The listing is **one environment's** since task 066: the Q6 switcher's environment,
 * which the route reads from the request. `environment` is on each row anyway, because a
 * table whose scope is only in the banner above it is a table somebody will read out of
 * context.
 */
export const LinkListItem = z
  .object({
    linkId: z.string().openapi({ example: "lnk_ab12cd34" }),
    environment: z.string().openapi({ example: "test" }),
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
