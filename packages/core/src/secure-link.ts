import { z } from "zod";

import { CompactTokenErrorCode, signCompactToken, verifyCompactToken } from "./compact-token.js";
import { err, ok, type Result } from "./errors.js";
import { FormId, LinkId } from "./ids.js";

/**
 * Secure links (SEC-2): signed, expiring, single-form tokens on the
 * compact-token machinery. The token format is documented in
 * `docs/secure-links.md`.
 *
 * A signature alone is never sufficient: the `secure_links` row must agree, so
 * one-time consumption and revocation stay storage's.
 *
 * No PII ever goes in a token: the claims are opaque ids and an expiry.
 */

/**
 * What a secure link asserts, with this schema as the source of truth (SEC-2).
 * `oneTime` is carried for the verifier's UX; the atomic consumption check
 * lives on the `secure_links` row.
 */
export const LinkClaims = z.object({
  formId: FormId,
  linkId: LinkId,
  expiresAt: z.iso.datetime(),
  oneTime: z.boolean().optional(),
});
export type LinkClaims = z.infer<typeof LinkClaims>;

/**
 * The compact-token failures plus `WRONG_FORM`, where the token is genuine but
 * for a different form than the caller expected.
 */
export const LinkErrorCode = z.enum([...CompactTokenErrorCode.options, "WRONG_FORM"]);
export type LinkErrorCode = z.infer<typeof LinkErrorCode>;

export const LinkError = z.object({
  code: LinkErrorCode,
  message: z.string().min(1),
});
export type LinkError = z.infer<typeof LinkError>;

/**
 * Mint a secure-link token for a form. Minting takes trusted author input, so
 * an invalid payload is a programming bug and throws rather than returning a
 * typed error.
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
 * Verify a secure-link token against the key list, newest first, at `now`.
 *
 * A verified result means the signature and claims are good; the caller must
 * still consult the `secure_links` row for revocation and one-time state.
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
