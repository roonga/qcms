import { describe, expect, it } from "vitest";

import { plainQuote, REASON_CHARS } from "./reason.ts";

/* The quoted reason is model prose shown as plain text, never as markup (SEC-17 §8d). */

describe("the card's quoted reason", () => {
  it("flattens the markdown a model writes anyway", () => {
    expect(plainQuote("Uses **bold**, *italic*, `code` and [a link](https://x.test).", 280)).toBe(
      "Uses bold, italic, code and a link.",
    );
  });

  it("drops an emphasis marker the pairs could not resolve, rather than quoting it", () => {
    expect(plainQuote("**What the card does***", 280)).toBe("What the card does");
    expect(plainQuote("**Unclosed emphasis", 280)).toBe("Unclosed emphasis");
  });

  it("stops on a paragraph boundary instead of part-way into the next one", () => {
    const text = [
      "The plan cannot do the exclusive answer.",
      "What the card does",
      `It ${"x ".repeat(200)}`,
    ].join("\n\n");
    expect(plainQuote(text, 280)).toBe("The plan cannot do the exclusive answer. …");
  });

  it("keeps a lead-in paragraph when nothing after it was dropped", () => {
    expect(plainQuote("What the card does\n\nIt creates the form.", 280)).toBe(
      "What the card does\nIt creates the form.",
    );
  });

  it("keeps a branded id whole, since an underscore pair there is not emphasis", () => {
    expect(plainQuote("Fixes q_known_allergies and a_b_c, plus __bold__.", 280)).toBe(
      "Fixes q_known_allergies and a_b_c, plus bold.",
    );
  });

  it("keeps a list on its own lines instead of running it together", () => {
    expect(plainQuote("New questions:\n- one\n- two\n- three\n", 280)).toBe(
      "New questions:\none\ntwo\nthree",
    );
  });

  it("keeps a heading that introduces a list apart from its first item", () => {
    expect(plainQuote("- About you step:\n  - Full name\n  - Date of birth.\n", 280)).toBe(
      "About you step:\nFull name\nDate of birth.",
    );
  });

  it("never runs two sentences together on one line", () => {
    expect(plainQuote("Done.\n- The first thing.\n- The second thing.\n", 280)).toBe(
      "Done.\nThe first thing.\nThe second thing.",
    );
  });

  it("drops whole lines rather than stopping one mid-thought, and says it stopped", () => {
    const quoted = plainQuote("Short enough.\n" + "word ".repeat(80), 40) ?? "";
    expect(quoted).toBe("Short enough. \u2026");
  });

  it("drops an item with no text rather than leaving its marker", () => {
    expect(plainQuote("Nothing to add:\n- \n", 280)).toBe("Nothing to add");
  });

  it("cuts one over-long line on a sentence boundary where there is one", () => {
    const text = `${"word ".repeat(40)}end. ${"tail ".repeat(40)}`;
    const quoted = plainQuote(text, 280) ?? "";
    expect(quoted.endsWith("end. \u2026")).toBe(true);
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
    expect(REASON_CHARS).toBe(560);
    // The marker that says the quote was cut is not part of the quoted text.
    expect((plainQuote("x ".repeat(600), REASON_CHARS) ?? "").length).toBeLessThanOrEqual(
      REASON_CHARS + 2,
    );
  });

  it("keeps a whole reason of several paragraphs, consequence and all", () => {
    const text = [
      "Version 1 of the Larkmead new patient sign-up goes to production.",
      "That is the version already running in test, where the clinic tries the form before anyone outside sees it.",
      "Everyone who opens the form answers version 1 from then on, for real.",
    ].join("\n\n");
    expect(plainQuote(text, REASON_CHARS)).toBe(text.replaceAll("\n\n", "\n"));
  });
});
