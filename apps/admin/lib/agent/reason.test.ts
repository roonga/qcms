import { describe, expect, it } from "vitest";

import { plainQuote, REASON_CHARS } from "./reason.ts";

/* The quoted reason is model prose shown as plain text, never as markup (SEC-17 §8d). */

describe("the card's quoted reason", () => {
  it("flattens the markdown a model writes anyway", () => {
    expect(plainQuote("Uses **bold**, *italic*, `code` and [a link](https://x.test).", 280)).toBe(
      "Uses bold, italic, code and a link.",
    );
  });

  it("keeps a branded id whole, since an underscore pair there is not emphasis", () => {
    expect(plainQuote("Fixes q_known_allergies and a_b_c, plus __bold__.", 280)).toBe(
      "Fixes q_known_allergies and a_b_c, plus bold.",
    );
  });

  it("turns a list into a comma-separated run", () => {
    expect(plainQuote("New questions:\n- one\n- two\n- three\n", 280)).toBe(
      "New questions: one, two, three",
    );
  });

  it("never follows a finished sentence with a comma", () => {
    expect(plainQuote("Done.\n- The first thing.\n- The second thing.\n", 280)).toBe(
      "Done. The first thing. The second thing.",
    );
  });

  it("drops an item with no text rather than leaving its marker", () => {
    expect(plainQuote("Nothing to add:\n- \n", 280)).toBe("Nothing to add");
  });

  it("cuts on a sentence boundary where there is one", () => {
    const text = `${"word ".repeat(40)}end. ${"tail ".repeat(40)}`;
    const quoted = plainQuote(text, 280) ?? "";
    expect(quoted.endsWith("end.")).toBe(true);
  });

  it("cuts on a word boundary otherwise, with an ellipsis", () => {
    const quoted = plainQuote("word ".repeat(100), 40) ?? "";
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted).not.toContain("wor…");
  });

  it("ends on no separator and keeps a sentence's own full stop", () => {
    expect(plainQuote("Short and sweet.", 280)).toBe("Short and sweet.");
    expect(plainQuote("Trailing commas,,, ", 280)).toBe("Trailing commas");
  });

  it("is absent where there is nothing to quote", () => {
    expect(plainQuote(undefined, 280)).toBeUndefined();
    expect(plainQuote("   ", 280)).toBeUndefined();
    expect(plainQuote("- ", 280)).toBeUndefined();
  });

  it("quotes at most the documented length", () => {
    expect(REASON_CHARS).toBe(280);
    expect((plainQuote("x ".repeat(400), REASON_CHARS) ?? "").length).toBeLessThanOrEqual(
      REASON_CHARS + 1,
    );
  });
});
