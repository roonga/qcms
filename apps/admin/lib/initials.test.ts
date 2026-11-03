import { describe, expect, it } from "vitest";

import { initialsFor } from "./initials.ts";

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
    expect(initialsFor("ada@example.test", "")).toBe("AD");
    expect(initialsFor("ada@example.test", "   ")).toBe("AD");
  });

  it("takes two characters from a single-word display name", () => {
    expect(initialsFor("ada@example.test", "Ada")).toBe("AD");
    expect(initialsFor("ada@example.test", "Prince")).toBe("PR");
  });

  it("gives a single character for a one-character local part", () => {
    expect(initialsFor("a@example.test")).toBe("A");
    expect(initialsFor("ada@example.test", "X")).toBe("X");
  });

  it("survives an address with nothing usable in its local part", () => {
    expect(initialsFor("...@example.test")).toBe("..");
    expect(initialsFor("")).toBe("");
  });

  it("keeps an astral character whole instead of splitting the surrogate pair", () => {
    const withEmojiFirstName = initialsFor("op@example.test", "\u{1F680} Rocket");
    expect(withEmojiFirstName).toBe("\u{1F680}R");
    expect(hasLoneSurrogate(withEmojiFirstName)).toBe(false);

    const twoEmoji = initialsFor("op@example.test", "\u{1F680}\u{1F4A1}");
    expect(twoEmoji).toBe("\u{1F680}\u{1F4A1}");
    expect(hasLoneSurrogate(twoEmoji)).toBe(false);
  });

  it("keeps a combining accent attached to its base letter", () => {
    expect(initialsFor("op@example.test", "e\u0301lodie Martin")).toBe("E\u0301M");

    expect(initialsFor("op@example.test", "e\u0301lodie")).toBe("E\u0301L");
  });
});

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (!isHigh && !isLow) continue;
    if (isLow) return true;
    const next = value.charCodeAt(index + 1);
    if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
    index += 1;
  }
  return false;
}
