import { describe, expect, it } from "vitest";

import { stripTags } from "./markup.ts";

describe("stripTags", () => {
  it("returns text with no tags unchanged", () => {
    expect(stripTags("Challenge required, minimum time 800 ms")).toBe(
      "Challenge required, minimum time 800 ms",
    );
  });

  it("removes a tag and keeps the text around it", () => {
    expect(stripTags('<span data-testid="x">Dead-lettered</span>')).toBe("Dead-lettered");
  });

  it("removes nested and adjacent tags", () => {
    expect(stripTags("<p><b>one</b> <i>two</i></p>")).toBe("one two");
  });

  it("does not reassemble a delimiter out of its own removal", () => {
    // Removing only an inner tag can reassemble surrounding delimiters into script markup; this scanner must
    // not do that.
    const reassembling = "<<b>script>alert(1)";
    expect(stripTags(reassembling)).not.toContain("<script");
    expect(stripTags(reassembling)).toBe("script>alert(1)");
  });

  it("drops an unterminated tag rather than emitting its remainder", () => {
    expect(stripTags("before<span class=")).toBe("before");
    expect(stripTags("<")).toBe("");
  });

  it("never returns a string containing an opening angle bracket", () => {
    const inputs = [
      "",
      "<",
      ">",
      "<<",
      "<>",
      "<<b>script>",
      "<<<b>>script>>",
      "a<b<c>d>e",
      "<img src=x onerror=alert(1)>",
      "text with a stray > bracket",
      '<span data-testid="q">a</span><span>b</span>',
    ];
    for (const input of inputs) {
      expect(
        stripTags(input),
        `stripTags(${JSON.stringify(input)}) must hold no "<"`,
      ).not.toContain("<");
    }
  });
});
