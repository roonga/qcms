import { describe, expect, it } from "vitest";

import { synthSecret } from "../../test-support.js";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  WebhookSecretDecryptError,
} from "./crypto.js";

/**
 * Webhook-secret at-rest encryption (SEC-6). Proves the round-trip 025 relies on
 * (encrypt at create → decrypt yields the original), that it is genuine
 * encryption not a hash (random IV → distinct ciphertexts, wrong key fails), and
 * that WebCrypto AES-GCM is used (envelope shape). Every app key here is
 * synthetic (SEC: no real secret in a test).
 */
describe("webhook secret encryption (AES-256-GCM under QCMS_APP_KEY)", () => {
  it("round-trips: decrypt(encrypt(secret)) === secret", async () => {
    const appKey = synthSecret();
    const secret = generateWebhookSecret();
    const stored = await encryptWebhookSecret(secret, appKey);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(secret); // ciphertext never contains the plaintext
    expect(await decryptWebhookSecret(stored, appKey)).toBe(secret);
  });

  it("uses a random IV: identical secret + key yields distinct ciphertexts", async () => {
    const appKey = synthSecret();
    const secret = "whsec_same-input";
    const a = await encryptWebhookSecret(secret, appKey);
    const b = await encryptWebhookSecret(secret, appKey);
    expect(a).not.toBe(b);
    // ...yet both decrypt back to the same plaintext.
    expect(await decryptWebhookSecret(a, appKey)).toBe(secret);
    expect(await decryptWebhookSecret(b, appKey)).toBe(secret);
  });

  it("fails authenticated decryption under the wrong app key", async () => {
    const stored = await encryptWebhookSecret("whsec_top", synthSecret());
    await expect(decryptWebhookSecret(stored, synthSecret())).rejects.toBeInstanceOf(
      WebhookSecretDecryptError,
    );
  });

  it("rejects a tampered ciphertext (GCM tag mismatch)", async () => {
    const appKey = synthSecret();
    const stored = await encryptWebhookSecret("whsec_top", appKey);
    // Flip a character in the base64 body.
    const flipped = stored.slice(0, -2) + (stored.at(-2) === "A" ? "B" : "A") + stored.at(-1);
    await expect(decryptWebhookSecret(flipped, appKey)).rejects.toBeInstanceOf(
      WebhookSecretDecryptError,
    );
  });

  it("rejects an envelope with an unknown version prefix", async () => {
    await expect(decryptWebhookSecret("v2.abc", synthSecret())).rejects.toBeInstanceOf(
      WebhookSecretDecryptError,
    );
  });

  it("generateWebhookSecret returns fresh high-entropy prefixed material", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
  });
});
