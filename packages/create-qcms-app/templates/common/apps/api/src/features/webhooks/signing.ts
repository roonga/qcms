// The timestamp is inside the signed material, so a consumer checking its freshness gets
// replay protection (SEC-6). Consumers verify `v1=hex(HMAC(secret, timestamp.body))`, so
// the signed material cannot change without breaking every existing verifier.

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

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
