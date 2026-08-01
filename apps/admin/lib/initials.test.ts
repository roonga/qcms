import { describe, expect, it } from "vitest";

import { initialsFor } from "./initials.ts";

/**
 * `initialsFor` is exported, so it is a seam with its own contract rather than an
 * implementation detail of the avatar (task 032 review batch, item 5).
 *
 * What makes it worth pinning is that every input is a STRANGER'S data - an operator's
 * display name and email address, neither of which this app chooses - and its output is
 * painted into a 32px disc with no room to degrade gracefully. The interesting cases are
 * therefore the short and the non-Latin ones, not the happy path.
 *
 * The result is decorative (the trigger's `aria-label` carries the real accessible name),
 * so none of this is a correctness requirement about WHICH letters appear. It is a
 * requirement that the function always produces something renderable.
 *
 * Every non-ASCII string below is written as an escape rather than as a literal. That is
 * deliberate and it is the whole point of two of these tests: a literal accented letter
 * is normalized to its PRECOMPOSED single-code-unit form by most editors, which is
 * exactly the form that passes on a broken implementation, so a literal would quietly
 * turn the interesting case into the boring one.
 */
describe("initialsFor", () => {
  it("takes one letter from each of the first two parts of a display name", () => {
    expect(initialsFor("ada@example.test", "Ada Lovelace")).toBe("AL");
  });

  it("falls back to the email's local part when there is no display name", () => {
    expect(initialsFor("ada.lovelace@example.test")).toBe("AL");
    expect(initialsFor("ada_lovelace@example.test")).toBe("AL");
    expect(initialsFor("ada-lovelace@example.test")).toBe("AL");
    expect(initialsFor("ada+tag@example.test")).toBe("AT");
  });

  it("treats a blank display name as absent rather than as a name", () => {
    // An empty string and a whitespace-only string both reach here from a nullable
    // profile field; either would otherwise produce an empty disc.
    expect(initialsFor("ada@example.test", "")).toBe("AD");
    expect(initialsFor("ada@example.test", "   ")).toBe("AD");
  });

  /**
   * A single-word display name has no second part to take a letter from, so it takes two
   * from the one part it has. This is the branch the two-part path never exercises.
   */
  it("takes two characters from a single-word display name", () => {
    expect(initialsFor("ada@example.test", "Ada")).toBe("AD");
    expect(initialsFor("ada@example.test", "Prince")).toBe("PR");
  });

  /**
   * A one-character local part must give one character, not one character plus padding
   * and not a crash: the cluster walk stops early, and the disc is happy with a single
   * letter.
   */
  it("gives a single character for a one-character local part", () => {
    expect(initialsFor("a@example.test")).toBe("A");
    expect(initialsFor("ada@example.test", "X")).toBe("X");
  });

  it("survives an address with nothing usable in its local part", () => {
    // Every character is a separator, so `parts` is empty and the fallback is the
    // untouched source. Never throws, never returns undefined.
    expect(initialsFor("...@example.test")).toBe("..");
    expect(initialsFor("")).toBe("");
  });

  /**
   * ASTRAL CHARACTERS: the reason `firstGraphemes` exists.
   *
   * An emoji is two UTF-16 code units, so the previous `parts[0]?.[0]` and
   * `.slice(0, 2)` cut one in half and handed the browser a LONE SURROGATE, which paints
   * as a replacement box. These assert the whole cluster survives - and, by asserting no
   * lone surrogate is present, they fail on the old implementation rather than merely
   * describing the new one.
   */
  it("keeps an astral character whole instead of splitting the surrogate pair", () => {
    const withEmojiFirstName = initialsFor("op@example.test", "\u{1F680} Rocket");
    expect(withEmojiFirstName).toBe("\u{1F680}R");
    expect(hasLoneSurrogate(withEmojiFirstName)).toBe(false);

    // Single-word, so it takes two clusters from one astral-only string.
    const twoEmoji = initialsFor("op@example.test", "\u{1F680}\u{1F4A1}");
    expect(twoEmoji).toBe("\u{1F680}\u{1F4A1}");
    expect(hasLoneSurrogate(twoEmoji)).toBe(false);
  });

  /**
   * COMBINING MARKS: a decomposed letter is one character to a reader and two to
   * `slice`. `"e" + U+0301` must come out as one accented letter, and must not spend the
   * whole two-character budget on itself when a second letter is available.
   *
   * Uppercasing a decomposed letter leaves it decomposed, so the expectations are
   * `"E" + U+0301` rather than the precomposed `U+00C9`.
   */
  it("keeps a combining accent attached to its base letter", () => {
    // Decomposed "elodie Martin" with an acute on the first letter.
    expect(initialsFor("op@example.test", "e\u0301lodie Martin")).toBe("E\u0301M");
    // Single word: two clusters, so the accent rides with the first and "l" is second.
    expect(initialsFor("op@example.test", "e\u0301lodie")).toBe("E\u0301L");
  });
});

/** True if `value` contains a surrogate code unit that is not part of a valid pair. */
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (!isHigh && !isLow) continue;
    if (isLow) return true; // A low surrogate the high branch below never consumed.
    const next = value.charCodeAt(index + 1);
    if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
    index += 1; // Valid pair; skip its low half.
  }
  return false;
}
