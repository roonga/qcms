// The signing secret must be recoverable to compute each delivery HMAC, so it is
// encrypted rather than hashed (SEC-6/SEC-8). Stored as `v1.<base64(iv‖ct‖tag)>`.

const IV_BYTES = 12;
const SCHEME_PREFIX = "v1.";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// `QCMS_APP_KEY` has no fixed byte length; SHA-256 gives AES-256 the exact 32 bytes.
async function deriveKey(appKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(appKey));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptWebhookSecret(plaintext: string, appKey: string): Promise<string> {
  const key = await deriveKey(appKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  return `${SCHEME_PREFIX}${toBase64(packed)}`;
}

export class WebhookSecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSecretDecryptError";
  }
}

// Error messages must never carry key or secret material (SEC-8).
export async function decryptWebhookSecret(stored: string, appKey: string): Promise<string> {
  if (!stored.startsWith(SCHEME_PREFIX)) {
    throw new WebhookSecretDecryptError("unrecognized webhook-secret envelope version");
  }
  let packed: Uint8Array;
  try {
    packed = fromBase64(stored.slice(SCHEME_PREFIX.length));
  } catch {
    throw new WebhookSecretDecryptError("webhook-secret envelope is not valid base64");
  }
  if (packed.length <= IV_BYTES) {
    throw new WebhookSecretDecryptError("webhook-secret envelope is too short");
  }
  const iv = packed.slice(0, IV_BYTES);
  const ciphertext = packed.slice(IV_BYTES);
  try {
    const key = await deriveKey(appKey);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return decoder.decode(plaintext);
  } catch {
    throw new WebhookSecretDecryptError("webhook secret failed authenticated decryption");
  }
}

// 32 random bytes keeps this at the SEC-7 minimum for key material.
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // eslint-disable-next-line sonarjs/super-linear-regex -- anchored single character-class; linear, no backtracking blowup
  const base64url = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `whsec_${base64url}`;
}
