/**
 * Webhook signing (task 025). Pure, no Docker. Cross-checks the WebCrypto
 * (`crypto.subtle`, R4) HMAC against the independent `node:crypto` reference the
 * consumer recipe in docs/webhooks.md documents - if the two ever diverge, either
 * the implementation or the published recipe is wrong.
 *
 * `node:crypto` is used **here in the test only** as an oracle; the production
 * signer never imports it (R4).
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signWebhookBody } from "./signing.js";

/** The documented Node consumer recipe, verbatim. */
function referenceSignature(secret: string, timestamp: string, body: string): string {
  const hex = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `v1=${hex}`;
}

describe("signWebhookBody", () => {
  const secret = "whsec_test_0123456789abcdef";
  const timestamp = "1753056000";
  const body = JSON.stringify({ eventId: "evt_1", eventType: "response.submitted", payload: {} });

  it("matches the documented node:crypto recipe (v1=hex HMAC-SHA256)", async () => {
    const sig = await signWebhookBody(secret, timestamp, body);
    expect(sig).toBe(referenceSignature(secret, timestamp, body));
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs", async () => {
    const a = await signWebhookBody(secret, timestamp, body);
    const b = await signWebhookBody(secret, timestamp, body);
    expect(a).toBe(b);
  });

  it("changes when the body is tampered with (so a modified payload fails verification)", async () => {
    const original = await signWebhookBody(secret, timestamp, body);
    const tampered = await signWebhookBody(secret, timestamp, body + " ");
    expect(tampered).not.toBe(original);
  });

  it("changes when the timestamp changes (binds the signature to its timestamp - replay defense)", async () => {
    const atT = await signWebhookBody(secret, timestamp, body);
    const atT2 = await signWebhookBody(secret, "1753056999", body);
    expect(atT2).not.toBe(atT);
  });

  it("changes when the secret differs", async () => {
    const withSecret = await signWebhookBody(secret, timestamp, body);
    const withOther = await signWebhookBody("whsec_other_key_9999", timestamp, body);
    expect(withOther).not.toBe(withSecret);
  });
});
