import { z } from "zod";

import { err, ok, type Result } from "./errors.js";
import { canonicalJson } from "./prepare-submission.js";

/**
 * Purpose-tagged compact tokens (task 010, SEC-2/SEC-7, ARCHITECTURE §7).
 *
 * A compact token is the kernel's minimal signed-claims shape:
 *
 *     base64url(canonicalJson(claims ∪ { purpose })) "." base64url(HMAC-SHA256)
 *
 * The HMAC is computed over the UTF-8 bytes of the encoded payload segment
 * (like a JWT signs its encoded segments), with WebCrypto `crypto.subtle`
 * only - fetch-pure (R4), so the same code runs in Node and on edge runtimes.
 *
 * ## Why not a JWT library
 *
 * A signed compact token ≈ a JWT, deliberately hand-rolled (task 010):
 * mainstream JWT libraries pull Node-only dependencies (`node:crypto`,
 * `Buffer`) which would break R4's fetch-purity, and they ship algorithm
 * agility (`alg` headers, RSA/ECDSA paths, `none`) that this kernel must
 * never accept - the qcms token inventory (SEC-7) is HMAC-SHA256 only, so
 * there is no header segment and no algorithm negotiation surface at all.
 *
 * ## Purposes and keys (SEC-7)
 *
 * Every token carries a `purpose` claim baked into the signed payload;
 * verification demands an exact match and each purpose gets its **own** key
 * list (`QCMS_LINK_KEYS` vs `QCMS_SESSION_KEYS` - supplied by the shell,
 * task 024). Both controls hold independently: even if an operator reuses a
 * key across purposes, the purpose claim still rejects cross-use
 * (`WRONG_PURPOSE`).
 *
 * ## Rotation
 *
 * `verifyCompactToken` accepts multiple keys: the **first** entry is the
 * current signing key, all entries verify, and candidates are tried in list
 * order (newest first). Rotation = prepend a new key, keep the old one until
 * every outstanding token has expired, then drop it. Key generation and
 * storage are shell concerns (task 024); the kernel only consumes
 * `CryptoKey`s.
 *
 * .NET mapping: like hand-rolling `JwtSecurityTokenHandler`'s HS256 path with
 * `IncrementalHash`-free, misuse-resistant primitives - except signature
 * comparison is delegated to `crypto.subtle.verify`, which is constant-time
 * (never compare digest bytes manually - timing side channel).
 */

/**
 * The closed set of token purposes in the SEC-7 inventory. `"link"` is the
 * secure-link token (this task); `"session"` is the respondent session token
 * (task 018, same machinery, distinct keys).
 */
export const TOKEN_PURPOSES = ["link", "session"] as const;
export const TokenPurpose = z.enum(TOKEN_PURPOSES);
export type TokenPurpose = z.infer<typeof TokenPurpose>;

/** Why a compact token failed verification (closed union, task 010). */
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

/**
 * Claims a caller supplies when signing: any JSON-serializable record.
 * `purpose` is reserved - the machinery writes it, callers never do.
 * `expiresAt`, when present, is the standard expiry claim (ISO 8601 UTC)
 * checked by `verifyCompactToken`.
 */
export type CompactTokenClaims = Record<string, unknown>;

/**
 * Signed-payload envelope: the purpose tag every token must carry plus the
 * optional standard expiry claim; purpose-specific claims pass through
 * (a loose object) for the caller to parse with its own schema.
 */
const CompactTokenPayload = z.looseObject({
  purpose: TokenPurpose,
  expiresAt: z.iso.datetime().optional(),
});

/** HMAC-SHA256 - the only algorithm compact tokens ever use (SEC-7). */
export const COMPACT_TOKEN_KEY_ALGORITHM = { name: "HMAC", hash: "SHA-256" } as const;

/** SEC-7 floor: signing keys are ≥ 32 random bytes. */
export const COMPACT_TOKEN_MIN_KEY_BYTES = 32;

/**
 * Import raw key bytes (from the shell's key-list env, task 024) as a
 * non-extractable HMAC-SHA256 `CryptoKey` usable with the sign/verify
 * functions here. Throws on keys shorter than 32 bytes - a weak key is a
 * deployment bug, not an expected failure.
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
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Decode a base64url segment; `undefined` for anything off-alphabet. */
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
 * Sign `claims` for `purpose` with the current signing key. The purpose is
 * written into the payload before signing, so it is covered by the HMAC and
 * cannot be re-tagged. Claims must not carry their own `purpose` (reserved -
 * a collision is a programming bug, hence throw not Result). Claims are
 * serialized with the package-wide `canonicalJson`, so signing is
 * deterministic regardless of input key order.
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
 * Verify a compact token for an expected purpose against a key list (newest
 * first - rotation, SEC-7). Check order: shape → signature (constant-time,
 * via `crypto.subtle.verify`, over every key until one matches) → purpose →
 * expiry. Nothing decoded from the payload is trusted before the signature
 * check passes. A token is valid strictly *before* `expiresAt`; at or after
 * it, `EXPIRED`.
 *
 * On success the returned claims are the signed payload minus the `purpose`
 * tag (already checked); callers parse them with their purpose's own schema
 * (e.g. `LinkClaims`).
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
    // crypto.subtle.verify recomputes the HMAC and compares in constant time
    // - never compare digest bytes manually (timing side channel).
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
