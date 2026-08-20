import type { MintedLink, SecureLink } from "../forms/types.ts";

import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/**
 * The secure-links screen's calls into the API's `/admin` group (task 034, R2).
 *
 * A proxy in the same shape as `forms.ts`, and for the same reason: this app holds
 * credentials, not authority. It does not mint a token, does not decide whether a link is
 * still usable, and does not know the signing key. Minting, state derivation
 * (active/consumed/expired/revoked) and revocation are all the API's, over 010's
 * cryptography and 018's verification.
 *
 * ## The token exists once
 *
 * `POST /forms/{id}/links` is the only response that will ever carry a link's URL. The API
 * stores a `secure_links` state row and **never the token**, so a minted URL that is not
 * copied out of the mint result is gone: it cannot be listed, re-read or re-derived. The
 * screen is built around that fact - the mint result is its own state with copy and CSV
 * export on it, and the links table shows lifecycle rather than URLs.
 *
 * A link URL is a bearer credential for one form. It is therefore treated the way this
 * repo treats every secret: never logged, never put in an error message, and never
 * persisted by this app (SEC-13).
 */

/** The batch cap the mint route enforces (`MAX_LINK_BATCH` in the API's links schema). */
export const MAX_LINK_BATCH = 100;

/**
 * `POST /admin/forms/{id}/links` - mint one link or a batch of them.
 *
 * `expiresAt` is an ISO instant in the future; `oneTime` marks a link consumed by its
 * first successful use; `count` is the batch size and is capped above as well as at the
 * route, so an absurd request is refused before it leaves the BFF.
 */
export async function mintLinks(
  session: AdminSession,
  formId: string,
  request: {
    readonly expiresAt: string;
    readonly oneTime: boolean;
    readonly count: number;
  },
): Promise<ApiResult<readonly MintedLink[]>> {
  const result = await readResult<{ links?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/links`, {
      method: "POST",
      body: request,
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseMinted(result.data.links) };
}

/** `GET /admin/forms/{id}/links` - the lifecycle table. No URLs, by construction. */
export async function listLinks(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<readonly SecureLink[]>> {
  const result = await readResult<{ links?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/links`),
  );
  if (!result.ok) return result;
  return { ok: true, data: parseLinks(result.data.links) };
}

/**
 * `POST /admin/forms/{id}/links/{linkId}/revoke` - 018 rejects the link from then
 * on. The form segment is what scopes the API's query (#478): a link minted for
 * another form is not revocable through this form's route.
 */
export async function revokeLink(
  session: AdminSession,
  formId: string,
  linkId: string,
): Promise<ApiResult<{ readonly linkId: string; readonly revokedAt: string }>> {
  const path: `/${string}` = `/forms/${encodeURIComponent(formId)}/links/${encodeURIComponent(linkId)}/revoke`;
  const result = await readResult<Record<string, unknown>>(
    await adminApiFetch(session, path, { method: "POST" }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      linkId: text(result.data["linkId"], linkId),
      revokedAt: text(result.data["revokedAt"], ""),
    },
  };
}

// --- reading the API's payloads ---------------------------------------------

const LINK_STATES: readonly SecureLink["state"][] = ["active", "consumed", "expired", "revoked"];

function text(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw !== "" ? raw : fallback;
}

function nullableText(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" ? raw : null;
}

function rows(raw: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
  );
}

function parseMinted(raw: unknown): readonly MintedLink[] {
  return rows(raw)
    .filter((entry) => typeof entry["url"] === "string")
    .map((entry) => ({
      linkId: text(entry["linkId"], ""),
      url: entry["url"] as string,
      expiresAt: text(entry["expiresAt"], ""),
    }));
}

/**
 * Read the lifecycle list.
 *
 * An unrecognised `state` reads as `"active"` rather than being dropped, and the direction
 * of that default is deliberate: a link this build cannot classify is still a live door
 * until someone revokes it, so it must stay visible and revocable rather than disappear
 * from the only screen that can close it.
 */
function parseLinks(raw: unknown): readonly SecureLink[] {
  return rows(raw)
    .filter((entry) => typeof entry["linkId"] === "string")
    .map((entry) => ({
      linkId: entry["linkId"] as string,
      state: LINK_STATES.find((state) => state === entry["state"]) ?? "active",
      oneTime: entry["oneTime"] === true,
      expiresAt: text(entry["expiresAt"], ""),
      consumedAt: nullableText(entry["consumedAt"]),
      revokedAt: nullableText(entry["revokedAt"]),
      createdAt: text(entry["createdAt"], ""),
    }));
}
