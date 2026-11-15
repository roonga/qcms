import { createHash, randomBytes } from "node:crypto";

/**
 * 256 bits, so a link cannot be guessed; the token exists in the message and in the
 * person's browser, never at rest. `control.sign_in_links` keeps only this digest.
 */
const TOKEN_BYTES = 32;

/** The admin path the emailed link points at. */
export const CLAIM_PATH = "/claim";

export function mintSignInToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Lower-case hex SHA-256. The token is high-entropy, so no salt or stretching applies. */
export function signInTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The path and query the message carries, resolved against the admin origin by `adminLink`. */
export function claimPathFor(token: string): string {
  return `${CLAIM_PATH}?token=${encodeURIComponent(token)}`;
}
