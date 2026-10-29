import {
  importCompactTokenKey,
  parseSessionId,
  type SessionId,
  signCompactToken,
  verifyCompactToken,
} from "@roonga/qcms-core";
import type { Context } from "hono";

import type { Config } from "../../config.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";

/** Signed into the HMAC, so a link token can never authenticate as a session (SEC-7). */
const SESSION_PURPOSE = "session" as const;

/** Newest-first order is preserved: the first key signs, all keys verify (rotation). */
export async function importSessionKeys(config: Config): Promise<CryptoKey[]> {
  return Promise.all(
    config.keys.session.map((raw) => importCompactTokenKey(new TextEncoder().encode(raw))),
  );
}

/** `expiresAt` is the session's own expiry, so a token never outlives its session row. */
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
 * Every failure returns the same 401 so the response is no oracle. Callers must
 * still check the bound session matches the one the path addresses (SEC-2).
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
