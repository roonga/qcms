import { describe, expect, it } from "vitest";

import {
  COMPACT_TOKEN_MIN_KEY_BYTES,
  importCompactTokenKey,
  signCompactToken,
  verifyCompactToken,
} from "./index.js";

/** Deterministic ≥32-byte key material for tests (never a real secret). */
function keyBytes(fill: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(COMPACT_TOKEN_MIN_KEY_BYTES).fill(fill);
}

const NOW = new Date("2026-07-20T12:00:00Z");
const FUTURE = "2026-07-21T00:00:00.000Z";

function decodePayload(token: string): Record<string, unknown> {
  const segment = token.split(".")[0] ?? "";
  const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))) as Record<
    string,
    unknown
  >;
}

function toBase64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function encodePayload(payload: Record<string, unknown>): string {
  return toBase64Url(JSON.stringify(payload));
}

/** Forge a token over arbitrary payload text with a *genuine* signature. */
async function forgeToken(key: CryptoKey, payloadText: string): Promise<string> {
  const segment = toBase64Url(payloadText);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(segment));
  return `${segment}.${toBase64Url(String.fromCharCode(...new Uint8Array(signature)))}`;
}

describe("importCompactTokenKey", () => {
  it("imports 32-byte raw keys (Uint8Array and ArrayBuffer)", async () => {
    const fromView = await importCompactTokenKey(keyBytes(1));
    const fromBuffer = await importCompactTokenKey(keyBytes(1).buffer);
    expect(fromView.algorithm).toMatchObject({ name: "HMAC" });
    expect(fromView.extractable).toBe(false);
    expect(fromBuffer.usages).toEqual(expect.arrayContaining(["sign", "verify"]));
  });

  it("throws on keys below the 32-byte SEC-7 floor", async () => {
    await expect(importCompactTokenKey(new Uint8Array(31))).rejects.toThrow(/at least 32 bytes/);
  });
});

describe("signCompactToken / verifyCompactToken", () => {
  it("round-trips claims and strips the purpose tag on verify", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken("session", { sessionId: "ses_abc" }, key);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const result = await verifyCompactToken("session", token, [key], NOW);
    expect(result).toEqual({ ok: true, value: { sessionId: "ses_abc" } });
  });

  it("signs deterministically regardless of claim key order (canonical JSON)", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const a = await signCompactToken("session", { a: 1, b: 2 }, key);
    const b = await signCompactToken("session", { b: 2, a: 1 }, key);
    expect(a).toBe(b);
  });

  it("rejects claims that set the reserved purpose claim", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    await expect(signCompactToken("session", { purpose: "link" }, key)).rejects.toThrow(
      /reserved "purpose"/,
    );
  });

  it("verifies under rotation: minted with A, verified against [B, A]", async () => {
    const keyA = await importCompactTokenKey(keyBytes(1));
    const keyB = await importCompactTokenKey(keyBytes(2));
    const token = await signCompactToken("session", { sessionId: "ses_abc" }, keyA);

    const rotated = await verifyCompactToken("session", token, [keyB, keyA], NOW);
    expect(rotated.ok).toBe(true);

    const dropped = await verifyCompactToken("session", token, [keyB], NOW);
    expect(dropped).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });
  });

  it("rejects an empty key list with BAD_SIGNATURE", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken("session", {}, key);
    const result = await verifyCompactToken("session", token, [], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });
  });

  it("rejects a cross-purpose token with WRONG_PURPOSE even under the same key (SEC-7)", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const linkToken = await signCompactToken("link", { formId: "frm_a" }, key);
    const result = await verifyCompactToken("session", linkToken, [key], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "WRONG_PURPOSE" } });
  });

  it("rejects garbage input as MALFORMED", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    // "abcde" is base64url-charset-valid but length-invalid: atob throws.
    for (const garbage of [
      "",
      "not-a-token",
      "a.b.c",
      "!!.??",
      ".",
      "abc.",
      ".abc",
      "abcde.abcde",
    ]) {
      const result = await verifyCompactToken("session", garbage, [key], NOW);
      expect(result, garbage).toMatchObject({ ok: false, error: { code: "MALFORMED" } });
    }
  });

  it("rejects a tampered signature with BAD_SIGNATURE", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken("session", { sessionId: "ses_abc" }, key);
    const [payload, signature] = token.split(".") as [string, string];
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    const result = await verifyCompactToken("session", `${payload}.${flipped}`, [key], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });
  });

  it("rejects a tampered payload with BAD_SIGNATURE", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken("session", { sessionId: "ses_abc" }, key);
    const signature = token.split(".")[1] ?? "";
    const tampered = encodePayload({ sessionId: "ses_other", purpose: "session" });
    const result = await verifyCompactToken("session", `${tampered}.${signature}`, [key], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });
  });

  it("rejects a correctly signed non-JSON payload as MALFORMED", async () => {
    // Signature-first ordering: forge a token whose payload is not JSON but
    // whose signature is genuine (even a key holder cannot make the kernel
    // accept a non-claims payload).
    const key = await importCompactTokenKey(keyBytes(1));
    const result = await verifyCompactToken(
      "session",
      await forgeToken(key, "not json"),
      [key],
      NOW,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "MALFORMED" } });
  });

  it("rejects signed payloads that are not claims objects as MALFORMED", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    for (const payload of ["[1,2]", '"text"', "{}", '{"purpose":"unknown"}']) {
      const result = await verifyCompactToken(
        "session",
        await forgeToken(key, payload),
        [key],
        NOW,
      );
      expect(result, payload).toMatchObject({ ok: false, error: { code: "MALFORMED" } });
    }
  });

  it("enforces the standard expiresAt claim: valid strictly before, EXPIRED at and after", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken("session", { expiresAt: FUTURE }, key);

    const before = await verifyCompactToken("session", token, [key], NOW);
    expect(before.ok).toBe(true);

    const atExpiry = await verifyCompactToken("session", token, [key], new Date(FUTURE));
    expect(atExpiry).toMatchObject({ ok: false, error: { code: "EXPIRED" } });

    const after = await verifyCompactToken(
      "session",
      token,
      [key],
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(after).toMatchObject({ ok: false, error: { code: "EXPIRED" } });
  });

  it("treats a non-datetime expiresAt as MALFORMED", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken("session", { expiresAt: "tomorrow" }, key);
    const result = await verifyCompactToken("session", token, [key], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "MALFORMED" } });
  });

  it("covers purpose in the signed bytes: re-tagging the payload breaks the signature", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken("link", { formId: "frm_a" }, key);
    const payload = decodePayload(token);
    const signature = token.split(".")[1] ?? "";
    const retagged = encodePayload({ ...payload, purpose: "session" });
    const result = await verifyCompactToken("session", `${retagged}.${signature}`, [key], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });
  });
});
