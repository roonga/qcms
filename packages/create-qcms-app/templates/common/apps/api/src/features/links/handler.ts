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

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  invalidLinkId: (): ApiError => new ApiError("INVALID_LINK_ID", 400, "Malformed link id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  unknownEnvironment: (name: string): ApiError =>
    new ApiError("UNKNOWN_ENVIRONMENT", 400, `This deployment serves no environment named ${name}`),
  linkNotFound: (): ApiError =>
    new ApiError("LINK_NOT_FOUND", 404, "No such link (or already revoked)"),
  expiryInPast: (): ApiError =>
    new ApiError("LINK_EXPIRY_INVALID", 400, "expiresAt must be a future ISO datetime"),
} as const;

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

async function requireForm(deps: Deps, formId: FormId): Promise<void> {
  const form = await getForm(deps.databases.control, formId);
  if (form === undefined) throw fail.formNotFound();
}

function newLinkId(): LinkId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return LinkId.parse(`lnk_${hex}`);
}

// Reuses `environmentPrefix` so a minted URL cannot disagree with the prefix the API
// actually mounts its respondent groups under.
function linkUrl(deps: Deps, token: string, environment: string): string {
  const prefix = environmentPrefix(environment);
  const path = prefix === "/" ? `/l/${token}` : `${prefix}/l/${token}`;
  return new URL(path, deps.config.portalBaseUrl).toString();
}

// Refuse an unknown environment rather than falling back to `prod`.
function requireEnvironment(deps: Deps, name: string): string {
  if (!deps.databases.names.includes(name)) throw fail.unknownEnvironment(name);
  return name;
}

// Revoked and consumed outrank expiry, so the order of these checks matters.
function linkState(row: SecureLinkRow, now: Date): "active" | "consumed" | "expired" | "revoked" {
  if (row.revokedAt !== null) return "revoked";
  if (row.consumedAt !== null) return "consumed";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function makeMintLinksHandler(deps: Deps): RouteHandler<typeof mintLinksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const { environment: named, expiresAt, oneTime, count } = c.req.valid("json");
    const now = deps.clock.now();
    // From the body, not the switcher header: minting distributes a link, so the caller
    // must state the environment rather than inherit it.
    const environment = requireEnvironment(deps, named);

    await requireForm(deps, formId);

    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) {
      throw fail.expiryInPast();
    }

    // First key signs, all keys verify, so rotation is a config change only.
    const signingRaw = deps.config.keys.link[0];
    if (signingRaw === undefined) throw new Error("no link signing key configured");
    const signingKey = await importCompactTokenKey(new TextEncoder().encode(signingRaw));

    const expiresAtIso = expiry.toISOString();
    const links: Array<{ linkId: string; environment: string; url: string; expiresAt: string }> =
      [];
    for (let i = 0; i < count; i += 1) {
      const linkId = newLinkId();
      // Row before token: verification rejects a token with no row. Control pool because only
      // `qcms_app_control` may INSERT into `secure_links`, so environment is an argument.
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

export function makeListLinksHandler(deps: Deps): RouteHandler<typeof listLinksRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const now = deps.clock.now();
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

export function makeRevokeLinkHandler(deps: Deps): RouteHandler<typeof revokeLinkRoute, ApiEnv> {
  return async (c) => {
    const params = c.req.valid("param");
    // No separate form existence check: form and environment are threaded into the
    // update's `where`, so a link in another form or environment matches no row and takes
    // the same 404 an unknown id takes, never leaking "not yours".
    const formId = requireFormId(params.id);
    const linkId = LinkId.safeParse(params.linkId);
    if (!linkId.success) throw fail.invalidLinkId();
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
