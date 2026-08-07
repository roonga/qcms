import { describe, expect, it, vi } from "vitest";

/**
 * The step-context cookie is validated, not asserted (issue #327).
 *
 * `qcms_step_ctx` carries the no-JS re-render context: the values a respondent
 * just posted and the errors the API refused them with. It is `httpOnly`, which
 * stops the page's own scripts reading it, but it is **unsigned**: a respondent
 * can set it by hand in their own browser, so everything `readStepContext`
 * returns is attacker-influenced input on the way to a render. It used to be
 * `JSON.parse(raw) as Partial<StepContext>` - a cast, which checks nothing.
 *
 * Two properties are asserted here. A cookie this app wrote still round-trips
 * unchanged (the fix must not cost a respondent their re-populated answers), and
 * a cookie of any other shape degrades to `undefined`, which is exactly what an
 * absent cookie already returned. Nothing throws: this runs inside a
 * respondent's page render, where an exception is a blank screen.
 *
 * `next/headers` is mocked because the cookie store only exists inside a Next
 * request.
 */

/** The raw cookie value the mocked store hands back, set per case. */
let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "qcms_step_ctx" && cookieValue !== undefined
          ? { name, value: cookieValue }
          : undefined,
    }),
}));

const { readStepContext } = await import("./route-helpers");

/** Point the mocked store at `raw` (or nothing) and read the context back. */
async function readCookie(raw: string | undefined) {
  cookieValue = raw;
  return readStepContext();
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
    };
    await expect(readCookie(JSON.stringify(written))).resolves.toEqual(written);
  });

  it("fills the members a writer omitted, so an earlier build's cookie still reads", async () => {
    // `constraints` postdates the cookie (task 048); a context written before it
    // must not be thrown away.
    await expect(
      readCookie(JSON.stringify({ values: { q_plate: "ABC-123" }, errors: {} })),
    ).resolves.toEqual({ values: { q_plate: "ABC-123" }, errors: {}, constraints: {} });
    await expect(readCookie("{}")).resolves.toEqual({ values: {}, errors: {}, constraints: {} });
  });

  it("drops a hand-forged entry whose value is the wrong type, and keeps the rest", async () => {
    // Each of these values was previously ACCEPTED verbatim by the bare cast and
    // handed to the renderer: a non-string error rendered as-is, and a non-string
    // constraint reached the authored-message lookup. None of them reaches it now.
    const context = await readCookie(
      JSON.stringify({
        values: { q_plate: "ABC-123", q_bad: { nested: "object" }, q_mixed: [1, 2, 3] },
        errors: { q_plate: "That does not look like a plate.", q_bad: 42 },
        constraints: { q_plate: "pattern", q_bad: ["pattern"] },
      }),
    );
    expect(context).toEqual({
      values: { q_plate: "ABC-123" },
      errors: { q_plate: "That does not look like a plate." },
      constraints: { q_plate: "pattern" },
    });
  });

  /**
   * The reason the records are lenient per entry rather than all-or-nothing. A
   * no-JS number field whose raw text is not numeric decodes to `NaN`
   * (`step-form.ts`, which leaves the judgement to the API), and `JSON.stringify`
   * writes `NaN` as `null`. So the cookie legitimately carries an out-of-union
   * value in exactly the case where the respondent most needs the error message
   * back. Rejecting the whole context here would blank the step instead.
   */
  it("keeps the error message when an answer value did not survive JSON (NaN -> null)", async () => {
    const written = JSON.stringify({
      values: { q_odometer: Number("abc"), q_plate: "ABC-123" },
      errors: { q_odometer: "Enter a number." },
      constraints: { q_odometer: "encoding" },
    });
    expect(written).toContain('"q_odometer":null');
    await expect(readCookie(written)).resolves.toEqual({
      values: { q_plate: "ABC-123" },
      errors: { q_odometer: "Enter a number." },
      constraints: { q_odometer: "encoding" },
    });
  });

  it("rejects the whole cookie when the envelope itself is not a context", async () => {
    // Structure is strict even though content is lenient: a member that is not a
    // record at all did not come from `writeStepContext`.
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
    // JSON.parse makes `__proto__` an own property rather than a prototype
    // assignment, but the value then flowed into a record the renderer iterates.
    // Validation drops the key, and the result keeps an ordinary prototype.
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
    ).resolves.toEqual({ values: {}, errors: {}, constraints: {} });
  });
});
