import { describe, expect, it } from "vitest";

import {
  COMPACT_TOKEN_MIN_KEY_BYTES,
  FormId,
  LinkId,
  importCompactTokenKey,
  mintSecureLink,
  signCompactToken,
  verifySecureLink,
  type LinkClaims,
} from "./index.js";

function keyBytes(fill: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(COMPACT_TOKEN_MIN_KEY_BYTES).fill(fill);
}

const NOW = new Date("2026-07-20T12:00:00Z");
const FORM_ID = FormId.parse("frm_auto_quote");
const OTHER_FORM_ID = FormId.parse("frm_other");
const LINK_ID = LinkId.parse("lnk_batch_2026_07_001");

const CLAIMS: LinkClaims = {
  formId: FORM_ID,
  linkId: LINK_ID,
  expiresAt: "2026-07-21T00:00:00.000Z",
};

describe("mintSecureLink / verifySecureLink", () => {
  it("round-trips claims, with and without oneTime", async () => {
    const key = await importCompactTokenKey(keyBytes(1));

    const plain = await verifySecureLink(await mintSecureLink(CLAIMS, key), [key], NOW);
    expect(plain).toEqual({ ok: true, value: CLAIMS });

    const oneTime = await verifySecureLink(
      await mintSecureLink({ ...CLAIMS, oneTime: true }, key),
      [key],
      NOW,
    );
    expect(oneTime).toEqual({ ok: true, value: { ...CLAIMS, oneTime: true } });
  });

  it("accepts the expected form and rejects a different one with WRONG_FORM", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await mintSecureLink(CLAIMS, key);

    const expected = await verifySecureLink(token, [key], NOW, FORM_ID);
    expect(expected.ok).toBe(true);

    const wrongForm = await verifySecureLink(token, [key], NOW, OTHER_FORM_ID);
    expect(wrongForm).toMatchObject({ ok: false, error: { code: "WRONG_FORM" } });
  });

  it("rejects an expired link with EXPIRED", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await mintSecureLink(CLAIMS, key);
    const result = await verifySecureLink(token, [key], new Date("2026-07-22T00:00:00Z"));
    expect(result).toMatchObject({ ok: false, error: { code: "EXPIRED" } });
  });

  it("verifies under rotation: minted with A, verified against [B, A]", async () => {
    const keyA = await importCompactTokenKey(keyBytes(1));
    const keyB = await importCompactTokenKey(keyBytes(2));
    const token = await mintSecureLink(CLAIMS, keyA);

    const rotated = await verifySecureLink(token, [keyB, keyA], NOW);
    expect(rotated).toEqual({ ok: true, value: CLAIMS });

    const dropped = await verifySecureLink(token, [keyB], NOW);
    expect(dropped).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });
  });

  it("rejects tampering: payload swap and signature flip are BAD_SIGNATURE", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await mintSecureLink(CLAIMS, key);
    const [payload, signature] = token.split(".") as [string, string];

    const otherToken = await mintSecureLink({ ...CLAIMS, formId: OTHER_FORM_ID }, key);
    const otherPayload = otherToken.split(".")[0] ?? "";
    const swapped = await verifySecureLink(`${otherPayload}.${signature}`, [key], NOW);
    expect(swapped).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });

    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    const badSig = await verifySecureLink(`${payload}.${flipped}`, [key], NOW);
    expect(badSig).toMatchObject({ ok: false, error: { code: "BAD_SIGNATURE" } });
  });

  it("rejects garbage input as MALFORMED", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    for (const garbage of ["", "nonsense", "a.b.c", "%%.$$"]) {
      const result = await verifySecureLink(garbage, [key], NOW);
      expect(result, garbage).toMatchObject({ ok: false, error: { code: "MALFORMED" } });
    }
  });

  it("rejects a session-purpose token with WRONG_PURPOSE even under the same key (SEC-7)", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const sessionToken = await signCompactToken("session", { sessionId: "ses_abc" }, key);
    const result = await verifySecureLink(sessionToken, [key], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "WRONG_PURPOSE" } });
  });

  it("rejects a genuine link-purpose token whose claims are not LinkClaims as MALFORMED", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await signCompactToken(
      "link",
      { formId: FORM_ID, expiresAt: CLAIMS.expiresAt }, // linkId missing
      key,
    );
    const result = await verifySecureLink(token, [key], NOW);
    expect(result).toMatchObject({ ok: false, error: { code: "MALFORMED" } });
  });

  it("throws on minting an invalid payload (programming bug, not a Result)", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    // Type-level fine (expiresAt is a string), runtime-invalid (not ISO 8601).
    const invalid = { ...CLAIMS, expiresAt: "tomorrow" };
    await expect(mintSecureLink(invalid, key)).rejects.toThrow(/not valid LinkClaims/);
  });

  it("puts no PII in the token: payload decodes to exactly the opaque claims", async () => {
    const key = await importCompactTokenKey(keyBytes(1));
    const token = await mintSecureLink({ ...CLAIMS, oneTime: false }, key);
    const segment = token.split(".")[0] ?? "";
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(decoded).sort()).toEqual([
      "expiresAt",
      "formId",
      "linkId",
      "oneTime",
      "purpose",
    ]);
  });
});
