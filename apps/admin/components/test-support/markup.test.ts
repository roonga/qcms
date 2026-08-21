import { describe, expect, it } from "vitest";

import { stripTags } from "./markup.ts";

/**
 * The scanner behind `textOfTestId`, tested for the property rather than the cases.
 *
 * This exists because "the lint finding went away" is not evidence that a sanitizer is
 * correct: the regex it replaced was quiet under ESLint too, and CodeQL only caught it
 * because a different tool happened to model delimiter reassembly. So the assertions here
 * are about the invariant the implementation is built on - the output cannot contain `<` -
 * and they include CodeQL's own counterexample by name, so a future edit that reintroduces
 * a single-pass strip fails here before it reaches a security scan.
 */
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
    // The exact shape CodeQL named. A single pass of `/<[^<>]+>/g` matches the inner
    // `<b>`, removes it, and the halves close up into `<script>`; this must not.
    const reassembling = "<<b>script>alert(1)";
    expect(stripTags(reassembling)).not.toContain("<script");
    expect(stripTags(reassembling)).toBe("script>alert(1)");
  });

  it("drops an unterminated tag rather than emitting its remainder", () => {
    expect(stripTags("before<span class=")).toBe("before");
    expect(stripTags("<")).toBe("");
  });

  it("never returns a string containing an opening angle bracket", () => {
    // The invariant, over every adversarial shape worth naming: reassembly, nesting,
    // unterminated tags, stray brackets, and an empty input.
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
