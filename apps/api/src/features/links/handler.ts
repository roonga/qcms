/**
 * Secure-link admin handlers (task 024, SEC-2).
 *
 * Honest transaction scripts (R5): the only kernel calls are token minting
 * (`mintSecureLink`, `importCompactTokenKey`); everything else is
 * shape-preserving `@roonga/qcms-db` reads/writes. Handlers are fetch-pure (R4): time
 * via `deps.clock`, crypto via WebCrypto, no `node:*`.
 *
 * Minting is the mirror of 018's verification: a `secure_links` state row is
 * inserted **and** a token is signed with the current `QCMS_LINK_KEYS` signing
 * key (`config.keys.link[0]` - "first signs, all verify", 010's rotation model),
 * so the token 018 later verifies always has an agreeing server row. Rotation is
 * operational and needs no code change: prepend a new key to `QCMS_LINK_KEYS` and
 * new mints sign with it while links minted under the old key still verify
 * (018 tries every key). The signing key is never logged (SEC-8).
 *
 * **Every route here is environment-scoped, since task 066** (ADR-40, Q19, Q21):
 *
 *   - the **mint** takes the environment from the request body, where it is required and
 *     has no default, writes it on the `secure_links` row, and returns a URL carrying
 *     `/<env>/` unless the environment is `prod`;
 *   - the **listing** and the **revoke** are scoped to the Q6 switcher's environment, so
 *     the screen an administrator is looking at and the rows it can act on are the same
 *     environment's.
 *
 * The environment is never in the token. The path names it, the row decides it, and
 * `start-session` refuses a token presented under the wrong prefix (Q21).
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { importCompactTokenKey, LinkId, mintSecureLink, parseFormId } from "@roonga/qcms-core";
import type { FormId } from "@roonga/qcms-core";
import {
  getForm,
  insertSecureLink,
  listSecureLinks,
  revokeSecureLink,
  type SecureLinkRow,
} from "@roonga/qcms-db";

import { environmentPrefix } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type { listLinksRoute, mintLinksRoute, revokeLinkRoute } from "./route.js";

// --- typed failures ---------------------------------------------------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  invalidLinkId: (): ApiError => new ApiError("INVALID_LINK_ID", 400, "Malformed link id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  /**
   * The environment named is not one this deployment serves.
   *
   * Checked against `databases.names`, the pools this process holds, which boot has
   * reconciled with `control.environments` (task 064, criterion 6a): an environment that
   * exists in the table but has no credential here is one no link into it could be
   * redeemed from, so minting for it would hand out an address that cannot work.
   */
  unknownEnvironment: (name: string): ApiError =>
    new ApiError("UNKNOWN_ENVIRONMENT", 400, `This deployment serves no environment named ${name}`),
  linkNotFound: (): ApiError =>
    new ApiError("LINK_NOT_FOUND", 404, "No such link (or already revoked)"),
  expiryInPast: (): ApiError =>
    new ApiError("LINK_EXPIRY_INVALID", 400, "expiresAt must be a future ISO datetime"),
} as const;

// --- shared helpers ---------------------------------------------------------

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

async function requireForm(deps: Deps, formId: FormId): Promise<void> {
  const form = await getForm(deps.databases.control, formId);
  if (form === undefined) throw fail.formNotFound();
}

/** A fresh branded `lnk_` id: 16 random hex bytes. */
function newLinkId(): LinkId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return LinkId.parse(`lnk_${hex}`);
}

/**
 * Build the shareable link URL from the configured portal base (SEC-8), carrying the
 * environment's address prefix (Q21).
 *
 * `prod` is unprefixed and every other environment is `/<env>/l/{token}`, which is the
 * **same** derivation the API mounts its respondent groups by
 * (`environmentPrefix` in `app.ts`) rather than a second spelling of the rule: the URL
 * this hands an operator has to be an address the portal serves and the API accepts, and
 * two copies of that arithmetic is one too many.
 *
 * The portal's own base URL is the host half. A non-prod environment may also be served
 * on a host of its own (SEC-14's two handles), which is ingress configuration and not
 * something this process can know, so the prefix is what a minted URL carries and an
 * operator rewrites the host if their deployment splits it.
 */
function linkUrl(deps: Deps, token: string, environment: string): string {
  const prefix = environmentPrefix(environment);
  const path = prefix === "/" ? `/l/${token}` : `${prefix}/l/${token}`;
  return new URL(path, deps.config.portalBaseUrl).toString();
}

/**
 * Refuse an environment this deployment does not serve, rather than defaulting one.
 *
 * The same check the releases slice makes, and for the same reason Q19 gives for
 * minting: a request whose environment is unknown is a request whose environment is
 * unknown, and serving it from `prod` is the failure that rule exists to prevent.
 */
function requireEnvironment(deps: Deps, name: string): string {
  if (!deps.databases.names.includes(name)) throw fail.unknownEnvironment(name);
  return name;
}

/** Derive display state from the row against the request clock (order matters). */
function linkState(row: SecureLinkRow, now: Date): "active" | "consumed" | "expired" | "revoked" {
  if (row.revokedAt !== null) return "revoked";
  if (row.consumedAt !== null) return "consumed";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

// --- POST /admin/forms/:id/links --------------------------------------------

export function makeMintLinksHandler(deps: Deps): RouteHandler<typeof mintLinksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const { environment: named, expiresAt, oneTime, count } = c.req.valid("json");
    const now = deps.clock.now();
    // Required by the schema and checked against the live set here (Q19). The body's
    // environment rather than the switcher's header, deliberately: minting a link is a
    // distributing action, so the environment is a value the caller states and the
    // admin's confirmation restates (Q6), not one it inherits from a header it may not
    // have been looking at.
    const environment = requireEnvironment(deps, named);

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
    const links: Array<{ linkId: string; environment: string; url: string; expiresAt: string }> =
      [];
    for (let i = 0; i < count; i += 1) {
      const linkId = newLinkId();
      // Insert the state row first, then mint the matching token: 018 rejects a
      // token whose row is absent, so the row must exist by the time a URL ships.
      //
      // Minting runs on the **control** pool, because `secure_links` is a control-plane
      // table and `qcms_app_control` is the only application role with `INSERT` on it.
      // An environment role deliberately holds `SELECT` and `UPDATE` there and no
      // `INSERT`: it redeems and consumes a link, it never creates one. That is also
      // why the environment is an argument rather than the connection's own - a control
      // connection has no environment (Q53's reasoning, whose interim `prod` this
      // request body replaces).
      await insertSecureLink(deps.databases.control, {
        linkId,
        formId,
        expiresAt: expiry,
        environment,
        oneTime,
      });
      const token = await mintSecureLink(
        { formId, linkId, expiresAt: expiresAtIso, oneTime },
        signingKey,
      );
      links.push({
        linkId,
        environment,
        url: linkUrl(deps, token, environment),
        expiresAt: expiresAtIso,
      });
    }

    return c.json({ links }, 201);
  };
}

// --- GET /admin/forms/:id/links ---------------------------------------------

export function makeListLinksHandler(deps: Deps): RouteHandler<typeof listLinksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const now = deps.clock.now();
    // The Q6 switcher's environment, or `prod` for a caller that named none. The listing
    // is one environment's (task 066), so the table and the banner above it agree.
    const environment = requireEnvironment(
      deps,
      c.get("requestEnvironment") ?? deps.databases.defaultEnvironment,
    );
    await requireForm(deps, formId);

    const rows = await listSecureLinks(deps.databases.control, formId, environment);
    return c.json(
      {
        links: rows.map((row) => ({
          linkId: row.linkId,
          environment: row.environment,
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

// --- POST /admin/forms/:id/links/:linkId/revoke ------------------------------

export function makeRevokeLinkHandler(deps: Deps): RouteHandler<typeof revokeLinkRoute, ApiEnv> {
  return async (c) => {
    const params = c.req.valid("param");
    // Form scope (#478, the idiom #305 established). The form segment is threaded
    // into the revoke query, so a link belonging to another form matches no row
    // and comes back 404 - indistinguishable from an id that was never issued.
    // Since task 066 the environment is threaded the same way.
    // Deliberately no `getForm` existence check: an unknown form makes the scoped
    // update match nothing, which is already the right 404, and asking separately
    // would add a second error path that has to agree with this one.
    const formId = requireFormId(params.id);
    const linkId = LinkId.safeParse(params.linkId);
    if (!linkId.success) throw fail.invalidLinkId();
    // Environment-scoped as well as form-scoped (task 066), by exactly the same
    // mechanism: the environment joins the update's `where` clause, so a link in another
    // environment matches no row and takes the same 404 a cross-form link takes. An
    // administrator revokes what the environment they are looking at listed.
    const environment = requireEnvironment(
      deps,
      c.get("requestEnvironment") ?? deps.databases.defaultEnvironment,
    );

    const now = deps.clock.now();
    const row = await revokeSecureLink(
      deps.databases.control,
      linkId.data,
      formId,
      environment,
      now,
    );
    // Idempotency choice: a link that does not exist in this form *or* is already
    // revoked returns 404 - the caller learns the link is not in a revocable state.
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
