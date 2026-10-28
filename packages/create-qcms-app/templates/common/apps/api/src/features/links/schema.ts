// The returned link URL is the one deliberate case of a token in a URL (SEC-8),
// mitigated by expiry and the `secure_links` row; the token is never persisted.

import { z } from "@hono/zod-openapi";

export const MAX_LINK_BATCH = 100;

export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
});

export const FormLinkParams = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_intake" }),
  linkId: z.string().openapi({ param: { name: "linkId", in: "path" }, example: "lnk_ab12cd34" }),
});

// `environment` has no default: a caller that omits it must be refused rather than
// silently handed a production link.
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

export const LinkState = z.enum(["active", "consumed", "expired", "revoked"]);

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

export const RevokedLinkResponse = z
  .object({
    linkId: z.string().openapi({ example: "lnk_ab12cd34" }),
    state: z.literal("revoked").openapi({ example: "revoked" }),
    revokedAt: z.string().openapi({ example: "2026-07-20T00:00:00.000Z" }),
  })
  .openapi("RevokedLinkResponse");
