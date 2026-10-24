import { z } from "zod";

import { err, ok, type Result } from "./errors.js";
import { canonicalJson } from "./prepare-submission.js";

// Hand-rolled rather than taken from a JWT library: the mainstream ones pull
// Node-only dependencies that would break fetch-purity (R4) and ship algorithm
// agility this kernel must never accept. The inventory is HMAC-SHA256 only
// (SEC-7), so there is no header segment and no negotiation surface at all.

/** Each purpose has its own key list (SEC-7). */
export const TOKEN_PURPOSES = ["link", "session"] as const;
export const TokenPurpose = z.enum(TOKEN_PURPOSES);
export type TokenPurpose = z.infer<typeof TokenPurpose>;

/** Why a compact token failed verification. */
export const CompactTokenErrorCode = z.enum([
  "MALFORMED",
  "BAD_SIGNATURE",
  "WRONG_PURPOSE",
  "EXPIRED",
]);
export type CompactTokenErrorCode = z.infer<typeof CompactTokenErrorCode>;

export const CompactTokenError = z.object({
  code: CompactTokenErrorCode,
  message: z.string().min(1),
});
export type CompactTokenError = z.infer<typeof CompactTokenError>;

/** `purpose` is reserved and `expiresAt` is the expiry verification checks. */
export type CompactTokenClaims = Record<string, unknown>;

// Loose, so purpose-specific claims pass through for the caller to parse.
const CompactTokenPayload = z.looseObject({
  purpose: TokenPurpose,
  expiresAt: z.iso.datetime().optional(),
});

/** The only algorithm compact tokens ever use (SEC-7). */
export const COMPACT_TOKEN_KEY_ALGORITHM = { name: "HMAC", hash: "SHA-256" } as const;

/** SEC-7 floor on signing-key length. */
export const COMPACT_TOKEN_MIN_KEY_BYTES = 32;

/**
 * Imports as non-extractable, and throws below the SEC-7 floor, a weak key
 * being a deployment bug rather than an expected failure.
 */
export async function importCompactTokenKey(
  rawKey: Uint8Array<ArrayBuffer> | ArrayBuffer,
): Promise<CryptoKey> {
  const byteLength = rawKey.byteLength;
  if (byteLength < COMPACT_TOKEN_MIN_KEY_BYTES) {
    throw new TypeError(
      `compact-token key must be at least ${String(COMPACT_TOKEN_MIN_KEY_BYTES)} bytes, got ${String(byteLength)}`,
    );
  }
  return crypto.subtle.importKey("raw", rawKey, COMPACT_TOKEN_KEY_ALGORITHM, false, [
    "sign",
    "verify",
  ]);
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  // eslint-disable-next-line sonarjs/super-linear-regex -- anchored single character-class; linear, no backtracking blowup
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** `undefined` for anything off-alphabet. */
function fromBase64Url(segment: string): Uint8Array<ArrayBuffer> | undefined {
  if (!BASE64URL_PATTERN.test(segment)) {
    return undefined;
  }
  const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * The purpose goes into the payload before signing, so the HMAC covers it and a
 * token cannot be re-tagged. A caller's own `purpose` claim throws, being a
 * programming bug.
 */
export async function signCompactToken(
  purpose: TokenPurpose,
  claims: CompactTokenClaims,
  key: CryptoKey,
): Promise<string> {
  if ("purpose" in claims) {
    throw new TypeError('compact-token claims must not set the reserved "purpose" claim');
  }
  const payloadSegment = toBase64Url(
    new TextEncoder().encode(canonicalJson({ ...claims, purpose })),
  );
  const signature = await crypto.subtle.sign(
    COMPACT_TOKEN_KEY_ALGORITHM.name,
    key,
    new TextEncoder().encode(payloadSegment),
  );
  return `${payloadSegment}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify against a key list, newest first, so rotation is prepending a key
 * (SEC-7). Nothing decoded is trusted before the signature check passes, so the
 * order is shape, signature, purpose, expiry.
 */
export async function verifyCompactToken(
  purpose: TokenPurpose,
  token: string,
  keys: readonly CryptoKey[],
  now: Date,
): Promise<Result<CompactTokenClaims, CompactTokenError>> {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return err({ code: "MALFORMED", message: "token is not two base64url segments" });
  }
  const [payloadSegment, signatureSegment] = parts;
  const payloadBytes = fromBase64Url(payloadSegment);
  const signatureBytes = fromBase64Url(signatureSegment);
  if (payloadBytes === undefined || signatureBytes === undefined) {
    return err({ code: "MALFORMED", message: "token segments are not base64url" });
  }

  const message = new TextEncoder().encode(payloadSegment);
  let signatureValid = false;
  for (const key of keys) {
    // Compares in constant time. Never compare digest bytes by hand: that is a
    // timing side channel.
    if (
      await crypto.subtle.verify(COMPACT_TOKEN_KEY_ALGORITHM.name, key, signatureBytes, message)
    ) {
      signatureValid = true;
      break;
    }
  }
  if (!signatureValid) {
    return err({ code: "BAD_SIGNATURE", message: "signature does not verify under any key" });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return err({ code: "MALFORMED", message: "payload is not valid JSON" });
  }
  const payload = CompactTokenPayload.safeParse(decoded);
  if (!payload.success) {
    return err({ code: "MALFORMED", message: "payload is not a valid claims object" });
  }
  const { purpose: tokenPurpose, ...claims } = payload.data;
  if (tokenPurpose !== purpose) {
    return err({
      code: "WRONG_PURPOSE",
      message: `token purpose "${tokenPurpose}" does not match expected "${purpose}"`,
    });
  }
  if (claims.expiresAt !== undefined && now.getTime() >= Date.parse(claims.expiresAt)) {
    return err({ code: "EXPIRED", message: "token expired" });
  }
  return ok(claims);
}
