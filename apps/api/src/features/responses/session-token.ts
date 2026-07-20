/**
 * Respondent session token (task 018, SEC-2).
 *
 * When a session is started (`POST /sessions`), the API mints an HMAC-signed
 * compact token (010 machinery) binding exactly one `sessionId`, and every later
 * respondent call carries it back. The portal BFF holds it in an httpOnly cookie
 * and forwards it as a bearer header on internal calls (R2, SEC-2) — client JS
 * never sees it.
 *
 * Two SEC-2 controls hold independently here:
 *
 * - **Purpose tag.** The token is signed with `purpose: "session"`; a
 *   secure-link token (`purpose: "link"`) can never authenticate as a session
 *   token even if an operator reused the key material — the purpose claim is
 *   inside the HMAC and `verifyCompactToken` demands an exact match
 *   (`WRONG_PURPOSE`).
 * - **Own key list.** Session tokens sign/verify under `QCMS_SESSION_KEYS`, a
 *   separate list from `QCMS_LINK_KEYS`; first entry signs, all verify
 *   (rotation).
 *
 * Fetch-pure (R4): keys are imported through WebCrypto (`importCompactTokenKey`,
 * `crypto.subtle`), never `node:crypto`. This module owns the session-token
 * vocabulary for the whole `responses` area; get-step/submit (019/020) reuse
 * `authenticateSession` when they land.
 */

import {
  importCompactTokenKey,
  parseSessionId,
  type SessionId,
  signCompactToken,
  verifyCompactToken,
} from "@qcms/core";
import type { Context } from "hono";

import type { Config } from "../../config.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";

/** The compact-token purpose tag for respondent session tokens (SEC-7). */
const SESSION_PURPOSE = "session" as const;

/**
 * Import a config key list (raw strings, ≥32 chars — validated at boot) into
 * non-extractable HMAC `CryptoKey`s. The UTF-8 bytes of a ≥32-char key are
 * ≥32 bytes, satisfying the compact-token key floor. Newest-first order is
 * preserved so the first key signs and all keys verify (rotation).
 */
export async function importSessionKeys(config: Config): Promise<CryptoKey[]> {
  return Promise.all(
    config.keys.session.map((raw) => importCompactTokenKey(new TextEncoder().encode(raw))),
  );
}

/**
 * Mint a session token binding `sessionId`, expiring with the session. The
 * `expiresAt` claim is the standard compact-token expiry, so a token outlives
 * neither its session row nor its own signature check.
 */
export async function mintSessionToken(
  sessionId: SessionId,
  expiresAt: Date,
  signingKey: CryptoKey,
): Promise<string> {
  return signCompactToken(
    SESSION_PURPOSE,
    { sessionId, expiresAt: expiresAt.toISOString() },
    signingKey,
  );
}

/**
 * Authenticate a respondent request from its `Authorization: Bearer <token>`
 * header and return the bound `SessionId`. Throws `ApiError` 401 for a missing,
 * malformed, wrong-purpose, expired, or forged token — never distinguishing
 * *why* to a caller (no oracle), while the reason is available for logging.
 *
 * The token authenticates the session; the caller still checks it addresses the
 * resource it asked for (path `id` match) — possession of a session id grants
 * nothing without the signed token (SEC-2 §3).
 */
export async function authenticateSession(c: Context<ApiEnv>, deps: Deps): Promise<SessionId> {
  const header = c.req.header("authorization");
  const bearer = header?.match(/^Bearer (.+)$/i)?.[1];
  if (bearer === undefined || bearer === "") {
    throw new ApiError("unauthorized", 401, "Missing session token");
  }
  const keys = await importSessionKeys(deps.config);
  const verified = await verifyCompactToken(SESSION_PURPOSE, bearer, keys, deps.clock.now());
  if (!verified.ok) {
    throw new ApiError("unauthorized", 401, "Invalid session token");
  }
  const sessionId = parseSessionId(verified.value.sessionId);
  if (!sessionId.ok) {
    throw new ApiError("unauthorized", 401, "Invalid session token");
  }
  return sessionId.value;
}
