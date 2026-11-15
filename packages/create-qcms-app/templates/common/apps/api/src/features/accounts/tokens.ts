/**
 * 256 bits, so a link cannot be guessed. The token exists in the message and in the
 * person's browser; `control.sign_in_links` keeps only its digest.
 */
const TOKEN_BYTES = 32;

/** The admin path the emailed link points at. */
export const CLAIM_PATH = "/claim";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hex rather than base64url, so the token needs no escaping in the link's query. */
export function mintSignInToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** Lower-case hex SHA-256. The token is high-entropy, so no salt or stretching applies. */
export async function signInTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/** The path and query the message carries, resolved against the admin origin by `adminLink`. */
export function claimPathFor(token: string): string {
  return `${CLAIM_PATH}?token=${encodeURIComponent(token)}`;
}
