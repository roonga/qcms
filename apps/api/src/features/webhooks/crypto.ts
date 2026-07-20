/**
 * Webhook-secret encryption at rest (task 024, SEC-6/SEC-8).
 *
 * The per-webhook signing secret must be **recoverable** - 025 decrypts it to
 * compute each delivery's `X-QCMS-Signature` HMAC - so it is *encrypted*, never
 * hashed. Encryption is AES-256-GCM under a key derived from `QCMS_APP_KEY`,
 * using WebCrypto only (R4: `crypto.subtle`, never `node:crypto`), so it runs
 * identically in Node and edge runtimes.
 *
 * Key derivation: `QCMS_APP_KEY` is validated at boot as ≥32 characters, but its
 * byte length is not fixed, whereas AES-256 needs exactly 32 bytes. We derive a
 * stable 32-byte key with SHA-256 over the app-key UTF-8 bytes. This is a
 * deterministic single-key derivation (no per-secret salt) - acceptable here
 * because AES-GCM's per-encryption random IV already guarantees distinct
 * ciphertexts for identical plaintexts, and the threat model is at-rest DB
 * disclosure, not offline key-stretching of a low-entropy password (the app key
 * is high-entropy random material, SEC-7).
 *
 * Wire format of the stored string: `v1.<base64(iv ‖ ciphertext ‖ tag)>`, where
 * the 12-byte IV is random per encryption and the 16-byte GCM tag is appended to
 * the ciphertext by WebCrypto. The `v1.` prefix leaves room for a future scheme
 * without a data migration. The plaintext secret is never returned by decrypt to
 * anything but the caller and is never logged (SEC-8).
 */

const IV_BYTES = 12;
const SCHEME_PREFIX = "v1.";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Derive the AES-256-GCM key from `QCMS_APP_KEY` (SHA-256 → 32 bytes). */
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

/**
 * Encrypt a webhook secret for at-rest storage. Returns the versioned,
 * base64-wrapped `v1.<iv‖ct‖tag>` string stored in `webhooks.secret_encrypted`.
 * A fresh random IV per call means identical secrets never share a ciphertext.
 */
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

/** Thrown when a stored ciphertext cannot be decrypted (wrong key or tampered). */
export class WebhookSecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSecretDecryptError";
  }
}

/**
 * Decrypt a stored webhook secret back to plaintext (for 025's delivery
 * signing). Throws {@link WebhookSecretDecryptError} on a malformed envelope or
 * a failed GCM authentication (wrong app key, or tampered ciphertext) - the
 * error message never contains key or secret material (SEC-8).
 */
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

/**
 * Generate a fresh webhook signing secret: `whsec_` + 32 random bytes as
 * base64url. High-entropy key material (SEC-7 ≥32 bytes); shown to the author
 * exactly once, then only its ciphertext persists.
 */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64url = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `whsec_${base64url}`;
}
