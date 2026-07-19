import { z } from "zod";

import { CompactTokenErrorCode, signCompactToken, verifyCompactToken } from "./compact-token.js";
import { err, ok, type Result } from "./errors.js";
import { FormId, LinkId } from "./ids.js";

/**
 * Secure links (task 010, SEC-2, ARCHITECTURE §7): signed, expiring,
 * single-form tokens — the first purpose (`"link"`) on the compact-token
 * machinery. The kernel mints and verifies over supplied key material only;
 * key storage/rotation is the shell's (024), and one-time consumption and
 * revocation are storage's (013/018) — *a signature alone is never
 * sufficient; the `secure_links` row must agree*. Token format documented in
 * `docs/secure-links.md`.
 *
 * No PII ever goes in a token: claims are opaque IDs and an expiry, nothing
 * else (SEC-2).
 */

/**
 * What a secure link asserts (Zod is the source of truth — SEC-2):
 * which form it opens, which minted-link row it is (`linkId`, so storage can
 * revoke and enforce one-time use), when it stops working, and whether it is
 * single-use. `oneTime` is carried in the token for the verifier's UX; the
 * atomic consumption check itself lives on the `secure_links` row (018).
 */
export const LinkClaims = z.object({
  formId: FormId,
  linkId: LinkId,
  expiresAt: z.iso.datetime(),
  oneTime: z.boolean().optional(),
});
export type LinkClaims = z.infer<typeof LinkClaims>;

/**
 * Why a secure link failed verification: the compact-token failures plus
 * `WRONG_FORM` (token is genuine but for a different form than the caller
 * expected).
 */
export const LinkErrorCode = z.enum([...CompactTokenErrorCode.options, "WRONG_FORM"]);
export type LinkErrorCode = z.infer<typeof LinkErrorCode>;

export const LinkError = z.object({
  code: LinkErrorCode,
  message: z.string().min(1),
});
export type LinkError = z.infer<typeof LinkError>;

/**
 * Mint a secure-link token for a form (admin feature; the shell supplies the
 * current `QCMS_LINK_KEYS` signing key). The payload is validated against
 * `LinkClaims` first — minting takes trusted author input, so an invalid
 * payload is a programming bug and throws rather than returning a Result.
 */
export async function mintSecureLink(payload: LinkClaims, key: CryptoKey): Promise<string> {
  const claims = LinkClaims.safeParse(payload);
  if (!claims.success) {
    throw new TypeError(
      `mintSecureLink payload is not valid LinkClaims: ${z.prettifyError(claims.error)}`,
    );
  }
  return signCompactToken("link", claims.data, key);
}

/**
 * Verify a secure-link token against the `QCMS_LINK_KEYS` list (newest
 * first — rotation) at time `now`. Failure order: `MALFORMED` →
 * `BAD_SIGNATURE` → `WRONG_PURPOSE` (SEC-7 cross-purpose rejection) →
 * `EXPIRED` → `MALFORMED` (signed claims that are not `LinkClaims`) →
 * `WRONG_FORM` (only when the caller passes `expectedFormId`).
 *
 * A verified result means the *signature and claims* are good; callers must
 * still consult the `secure_links` row for revocation/one-time state (018).
 */
export async function verifySecureLink(
  token: string,
  keys: readonly CryptoKey[],
  now: Date,
  expectedFormId?: FormId,
): Promise<Result<LinkClaims, LinkError>> {
  const verified = await verifyCompactToken("link", token, keys, now);
  if (!verified.ok) {
    return verified;
  }
  const claims = LinkClaims.safeParse(verified.value);
  if (!claims.success) {
    return err({ code: "MALFORMED", message: "signed claims are not valid link claims" });
  }
  if (expectedFormId !== undefined && claims.data.formId !== expectedFormId) {
    return err({ code: "WRONG_FORM", message: "link is for a different form" });
  }
  return ok(claims.data);
}
