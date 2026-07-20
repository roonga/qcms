/**
 * Secure-link admin handlers (task 024, SEC-2).
 *
 * Honest transaction scripts (R5): the only kernel calls are token minting
 * (`mintSecureLink`, `importCompactTokenKey`); everything else is
 * shape-preserving `@qcms/db` reads/writes. Handlers are fetch-pure (R4): time
 * via `deps.clock`, crypto via WebCrypto, no `node:*`.
 *
 * Minting is the mirror of 018's verification: a `secure_links` state row is
 * inserted **and** a token is signed with the current `QCMS_LINK_KEYS` signing
 * key (`config.keys.link[0]` - "first signs, all verify", 010's rotation model),
 * so the token 018 later verifies always has an agreeing server row. Rotation is
 * operational and needs no code change: prepend a new key to `QCMS_LINK_KEYS` and
 * new mints sign with it while links minted under the old key still verify
 * (018 tries every key). The signing key is never logged (SEC-8).
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { importCompactTokenKey, LinkId, mintSecureLink, parseFormId } from "@qcms/core";
import type { FormId } from "@qcms/core";
import { getForm, insertSecureLink, listSecureLinks, revokeSecureLink } from "@qcms/db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { listLinksRoute, mintLinksRoute, revokeLinkRoute } from "./route.js";

// --- typed failures ---------------------------------------------------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  invalidLinkId: (): ApiError => new ApiError("INVALID_LINK_ID", 400, "Malformed link id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  linkNotFound: (): ApiError =>
    new ApiError("LINK_NOT_FOUND", 404, "No such link (or already revoked)"),
  expiryInPast: (): ApiError =>
    new ApiError("LINK_EXPIRY_INVALID", 400, "expiresAt must be a future ISO datetime"),
} as const;

/** Enum-free `forms` fields this slice needs (issue #5 launder on the read). */
interface FormRowView {
  readonly formId: FormId;
}

/**
 * `secure_links` fields this slice reads back. The `link_id` column is a branded
 * `LinkId` that reads as an error type through @qcms/db's emitted `.d.ts` (issue
 * #5 - the same launder the forms/sessions rows need); a narrow local view with
 * `linkId` as a plain string keeps the slice fully typed.
 */
interface SecureLinkRowView {
  readonly linkId: string;
  readonly oneTime: boolean;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

// --- shared helpers ---------------------------------------------------------

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

async function requireForm(deps: Deps, formId: FormId): Promise<void> {
  const form = (await getForm(deps.db, formId)) as FormRowView | undefined;
  if (form === undefined) throw fail.formNotFound();
}

/** A fresh branded `lnk_` id: 16 random hex bytes. */
function newLinkId(): LinkId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return LinkId.parse(`lnk_${hex}`);
}

/** Build the shareable link URL from the configured portal base (SEC-8). */
function linkUrl(deps: Deps, token: string): string {
  return new URL(`/l/${token}`, deps.config.portalBaseUrl).toString();
}

/** Derive display state from the row against the request clock (order matters). */
function linkState(
  row: SecureLinkRowView,
  now: Date,
): "active" | "consumed" | "expired" | "revoked" {
  if (row.revokedAt !== null) return "revoked";
  if (row.consumedAt !== null) return "consumed";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

// --- POST /admin/forms/:id/links --------------------------------------------

export function makeMintLinksHandler(deps: Deps): RouteHandler<typeof mintLinksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const { expiresAt, oneTime, count } = c.req.valid("json");
    const now = deps.clock.now();

    await requireForm(deps, formId);

    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) {
      throw fail.expiryInPast();
    }

    // The current signing key (first entry; boot guarantees ≥1 link key).
    const signingRaw = deps.config.keys.link[0];
    if (signingRaw === undefined) throw new Error("no link signing key configured");
    const signingKey = await importCompactTokenKey(new TextEncoder().encode(signingRaw));

    const expiresAtIso = expiry.toISOString();
    const links: Array<{ linkId: string; url: string; expiresAt: string }> = [];
    for (let i = 0; i < count; i += 1) {
      const linkId = newLinkId();
      // Insert the state row first, then mint the matching token: 018 rejects a
      // token whose row is absent, so the row must exist by the time a URL ships.
      await insertSecureLink(deps.db, { linkId, formId, expiresAt: expiry, oneTime });
      const token = await mintSecureLink(
        { formId, linkId, expiresAt: expiresAtIso, oneTime },
        signingKey,
      );
      links.push({ linkId, url: linkUrl(deps, token), expiresAt: expiresAtIso });
    }

    return c.json({ links }, 201);
  };
}

// --- GET /admin/forms/:id/links ---------------------------------------------

export function makeListLinksHandler(deps: Deps): RouteHandler<typeof listLinksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const now = deps.clock.now();
    await requireForm(deps, formId);

    const rows = (await listSecureLinks(deps.db, formId)) as unknown as SecureLinkRowView[];
    return c.json(
      {
        links: rows.map((row) => ({
          linkId: row.linkId,
          state: linkState(row, now),
          oneTime: row.oneTime,
          expiresAt: row.expiresAt.toISOString(),
          consumedAt: row.consumedAt === null ? null : row.consumedAt.toISOString(),
          revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        })),
      },
      200,
    );
  };
}

// --- POST /admin/links/:linkId/revoke ---------------------------------------

export function makeRevokeLinkHandler(deps: Deps): RouteHandler<typeof revokeLinkRoute, ApiEnv> {
  return async (c) => {
    const linkId = LinkId.safeParse(c.req.valid("param").linkId);
    if (!linkId.success) throw fail.invalidLinkId();

    const now = deps.clock.now();
    const row = (await revokeSecureLink(deps.db, linkId.data, now)) as
      SecureLinkRowView | undefined;
    // Idempotency choice: a link that does not exist *or* is already revoked
    // returns 404 - the caller learns the link is not in a revocable state.
    if (row === undefined) throw fail.linkNotFound();

    return c.json(
      {
        linkId: row.linkId,
        state: "revoked" as const,
        revokedAt: (row.revokedAt ?? now).toISOString(),
      },
      200,
    );
  };
}
