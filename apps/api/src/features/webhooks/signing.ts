/**
 * Webhook request signing (task 025, SEC-6).
 *
 * Each delivery carries a timestamped HMAC-SHA256 signature the consumer verifies
 * to prove (a) the request came from this qcms instance — it holds the shared
 * per-webhook secret — and (b) the body was not tampered with in flight. The
 * timestamp is part of the signed material, so a consumer that also checks the
 * timestamp's freshness gets replay protection: a captured request cannot be
 * replayed outside the acceptance window without invalidating the signature.
 *
 * **WebCrypto only (R4).** `crypto.subtle.sign` with HMAC-SHA256 — never
 * `node:crypto` — so this runs unchanged in Node and edge runtimes. The signing
 * key is the webhook's plaintext secret (recovered from its at-rest ciphertext by
 * `crypto.decryptWebhookSecret` at delivery time); it is never logged (SEC-8).
 *
 * Wire format: `X-QCMS-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`.
 * The `v1=` scheme prefix leaves room for future algorithms without breaking
 * existing verifiers. Signed material is `${timestamp}.${body}` — the exact bytes
 * of `X-QCMS-Timestamp` and the request body — so the consumer signs the raw body
 * it received, byte for byte.
 */

const encoder = new TextEncoder();

/** Lowercase-hex encode raw MAC bytes. */
function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Compute the `X-QCMS-Signature` value for a delivery: `v1=` followed by the hex
 * HMAC-SHA256 of `${timestamp}.${body}` under `secret`. Pure over its inputs.
 */
export async function signWebhookBody(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return `v1=${toHex(new Uint8Array(mac))}`;
}
