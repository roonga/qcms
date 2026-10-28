import { describe, expect, it, vi } from "vitest";

import { mergeStepValues } from "../step-values";

/** The raw cookie values the mocked store hands back, set per case. */
let cookieValue: string | undefined;
let receiptCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = new Map([
          ["qcms_step_ctx", cookieValue],
          ["qcms_receipt", receiptCookieValue],
        ]).get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

const { readReceiptCookie, readStepContext } = await import("./route-helpers");

/** Point the mocked store at `raw` (or nothing) and read the context back. */
async function readCookie(raw: string | undefined) {
  cookieValue = raw;
  return readStepContext();
}

/** Point the mocked store at `raw` (or nothing) and read the receipt back. */
async function readReceipt(raw: string | undefined) {
  receiptCookieValue = raw;
  return readReceiptCookie();
}

describe("readStepContext", () => {
  it("returns undefined when the cookie is absent (the baseline every rejection matches)", async () => {
    await expect(readCookie(undefined)).resolves.toBeUndefined();
  });

  it("round-trips a context this app wrote, unchanged", async () => {
    const written = {
      values: { q_plate: "ABC-123", q_odometer: 42, q_insured: true, q_extras: ["a", "b"] },
      errors: { q_plate: "That does not look like a plate." },
      constraints: { q_plate: "pattern" },
      missingRequired: ["q_odometer"],
    };
    await expect(readCookie(JSON.stringify(written))).resolves.toEqual(written);
  });

  it("fills the members a writer omitted, so an earlier build's cookie still reads", async () => {
    await expect(
      readCookie(JSON.stringify({ values: { q_plate: "ABC-123" }, errors: {} })),
    ).resolves.toEqual({
      values: { q_plate: "ABC-123" },
      errors: {},
      constraints: {},
      missingRequired: [],
    });
    await expect(readCookie("{}")).resolves.toEqual({
      values: {},
      errors: {},
      constraints: {},
      missingRequired: [],
    });
  });

  it("drops a hand-forged errors or constraints entry, and keeps the rest", async () => {
    const context = await readCookie(
      JSON.stringify({
        errors: { q_plate: "That does not look like a plate.", q_bad: 42 },
        constraints: { q_plate: "pattern", q_bad: ["pattern"] },
      }),
    );
    expect(context?.errors).toEqual({ q_plate: "That does not look like a plate." });
    expect(context?.constraints).toEqual({ q_plate: "pattern" });
  });

  it("drops a hand-forged missingRequired entry that is not a question id (issue #920)", async () => {
    const context = await readCookie(
      JSON.stringify({ missingRequired: ["q_odometer", 42, { q: 1 }, null] }),
    );
    expect(context?.missingRequired).toEqual(["q_odometer"]);
  });

  it("refuses a missingRequired that is not a list at all", async () => {
    await expect(
      readCookie(JSON.stringify({ missingRequired: "q_odometer" })),
    ).resolves.toBeUndefined();
  });

  it("CLEARS an unreadable values entry rather than dropping it", async () => {
    const context = await readCookie(
      JSON.stringify({ values: { q_plate: "ABC-123", q_bad: { nested: "object" } } }),
    );
    expect(Object.hasOwn(context?.values ?? {}, "q_bad")).toBe(true);
    expect(context?.values.q_bad).toBeUndefined();
    expect(context?.values.q_plate).toBe("ABC-123");
  });

  it("blanks a refused number field instead of restoring the accepted answer (NaN -> null)", async () => {
    const written = JSON.stringify({
      values: { q_odometer: Number("abc"), q_plate: "ABC-123" },
      errors: { q_odometer: "Enter a number." },
      constraints: { q_odometer: "encoding" },
    });
    expect(written).toContain('"q_odometer":null');

    const context = await readCookie(written);
    expect(context?.errors).toEqual({ q_odometer: "Enter a number." });

    const stored = { q_odometer: 5, q_plate: "OLD-000" };
    const merged = mergeStepValues(stored, context?.values);
    expect(merged.q_odometer).toBeUndefined();
    expect(merged.q_plate).toBe("ABC-123");
  });

  it("rejects the whole cookie when the envelope itself is not a context", async () => {
    for (const raw of [
      "null",
      '"a string"',
      "42",
      "true",
      "[]",
      JSON.stringify({ values: null, errors: null, constraints: null }),
      JSON.stringify({ errors: "not a record" }),
      JSON.stringify({ errors: ["not", "a", "record"] }),
    ]) {
      await expect(readCookie(raw), raw).resolves.toBeUndefined();
    }
  });

  it("returns undefined rather than throwing on unparseable JSON", async () => {
    await expect(readCookie("not json at all")).resolves.toBeUndefined();
    await expect(readCookie("")).resolves.toBeUndefined();
  });

  it("drops a __proto__ key rather than carrying it into the returned records", async () => {
    const context = await readCookie(
      '{"constraints":{"__proto__":"toString","q_plate":"pattern"},"errors":{"q_plate":"nope"}}',
    );
    expect(context?.constraints).toEqual({ q_plate: "pattern" });
    expect(Object.keys(context?.constraints ?? {})).not.toContain("__proto__");
    expect(Object.getPrototypeOf(context?.constraints)).toBe(Object.prototype);
  });

  it("ignores unknown top-level members instead of forwarding them", async () => {
    await expect(
      readCookie(JSON.stringify({ errors: {}, sessionToken: "stolen", admin: true })),
    ).resolves.toEqual({ values: {}, errors: {}, constraints: {}, missingRequired: [] });
  });
});

describe("readReceiptCookie", () => {
  /** Exactly what the API's `receiptFrom` builds: an ISO instant and a hex hash. */
  const written = {
    submittedAt: new Date(Date.UTC(2026, 6, 20)).toISOString(),
    contentHash: "3b0c".repeat(16),
  };

  it("round-trips a receipt this app wrote, unchanged (positive control)", async () => {
    expect(written.submittedAt).toBe("2026-07-20T00:00:00.000Z");
    await expect(readReceipt(JSON.stringify(written))).resolves.toEqual(written);
  });

  it("returns undefined when the cookie is absent (the baseline every rejection matches)", async () => {
    await expect(readReceipt(undefined)).resolves.toBeUndefined();
  });

  it("rejects JSON that parses but is not a receipt", async () => {
    for (const raw of [
      JSON.stringify({ submittedAt: written.submittedAt }),
      JSON.stringify({ contentHash: written.contentHash }),
      JSON.stringify({ submittedAt: 1_753_000_000_000, contentHash: written.contentHash }),
      JSON.stringify({ submittedAt: written.submittedAt, contentHash: ["forged"] }),
      JSON.stringify({ submittedAt: null, contentHash: null }),
      "{}",
      "[]",
      '"a string"',
      "42",
      "true",
      "null",
    ]) {
      await expect(readReceipt(raw), raw).resolves.toBeUndefined();
    }
  });

  it("rejects a submittedAt that is a string but not an instant", async () => {
    const forged = { submittedAt: "yesterday", contentHash: written.contentHash };
    expect(new Date(forged.submittedAt).toString()).toBe("Invalid Date");
    await expect(readReceipt(JSON.stringify(forged))).resolves.toBeUndefined();
  });

  it("strips forged extra members instead of forwarding them", async () => {
    await expect(
      readReceipt(JSON.stringify({ ...written, sessionToken: "stolen", admin: true })),
    ).resolves.toEqual(written);
  });

  it("returns undefined rather than throwing on unparseable JSON", async () => {
    await expect(readReceipt("not json at all")).resolves.toBeUndefined();
    await expect(readReceipt("")).resolves.toBeUndefined();
  });

  it("gives every unusable cookie the one answer an absent cookie gives", async () => {
    const absent = await readReceipt(undefined);
    const unparseable = await readReceipt("}{");
    const wrongShape = await readReceipt(JSON.stringify({ submittedAt: 0, contentHash: 0 }));
    expect(unparseable).toBe(absent);
    expect(wrongShape).toBe(absent);
  });
});
