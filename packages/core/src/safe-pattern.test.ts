import { describe, expect, it } from "vitest";

import {
  SAFE_PATTERN_MAX_BOUND,
  SAFE_PATTERN_MAX_COMPOSITE_BOUND,
  SAFE_PATTERN_MAX_LENGTH,
  checkSafePattern,
  classSetAmbiguity,
  isSafePattern,
} from "./index.js";

const ACCEPTED: readonly string[] = [
  "^[A-Za-z]{2,10}$",
  "^\\d{4}$",
  "^(?:red|green|blue)$",
  "^a+b*c??d{2,}$",
  "^(?:\\d{1,3}\\.){3}\\d{1,3}$", // bounded repetition of a composite group
  "\\p{L}+",
  "^[\\]\\-a-z^]{1,20}$",
  "^(?<area>\\d{2}) \\d{4} \\d{4}$", // named group, never backreferenced
  "^\\u0041\\u{1F600}$",
  "(ab)+", // plain group repeated: no inner quantifier or alternation
  "^\\w+@\\w+\\.\\w{2,6}$",
  "",
];

const UNSUPPORTED: readonly string[] = [
  "^(a+)+$", // the classic catastrophic shape
  "(\\d*)*",
  "((a+)b)*", // composite nested one level down
  "(a|ab)+x",
  "(?:a|b)*", // unbounded over alternation (conservatively rejected)
  `(?:a+){${SAFE_PATTERN_MAX_COMPOSITE_BOUND + 1}}`, // composite bound cap
  `a{${SAFE_PATTERN_MAX_BOUND + 1}}`, // plain bound cap
  "(a)\\1", // backreference
  "(?<x>a)\\k<x>", // named backreference
  "(?=a)b", // lookahead
  "(?!a)b",
  "(?<=a)b", // lookbehind
  "(?<!a)b",
  "a".repeat(SAFE_PATTERN_MAX_LENGTH + 1),
];

const INVALID: readonly string[] = [
  "^(unclosed$",
  "a{2,1}",
  "[z-a]",
  "\\q", // invalid escape under the u flag
  "a**",
];

describe("checkSafePattern", () => {
  it.each(ACCEPTED)("accepts %j", (pattern) => {
    expect(checkSafePattern(pattern)).toBeUndefined();
    expect(isSafePattern(pattern)).toBe(true);
  });

  it.each(UNSUPPORTED)("rejects %j as PATTERN_UNSUPPORTED", (pattern) => {
    expect(checkSafePattern(pattern)?.code).toBe("PATTERN_UNSUPPORTED");
    expect(isSafePattern(pattern)).toBe(false);
  });

  it.each(INVALID)("rejects %j as PATTERN_INVALID", (pattern) => {
    expect(checkSafePattern(pattern)?.code).toBe("PATTERN_INVALID");
    expect(isSafePattern(pattern)).toBe(false);
  });

  it("allows bounded repetition of a composite group up to the cap", () => {
    expect(isSafePattern(`(?:a+){${SAFE_PATTERN_MAX_COMPOSITE_BOUND}}`)).toBe(true);
    expect(isSafePattern("(?:a|b){4}")).toBe(true);
  });

  it("never echoes the pattern into the issue message", () => {
    const issue = checkSafePattern("(secret-content+)+");
    expect(issue?.message).not.toContain("secret-content");
  });
});

describe("classSetAmbiguity (issue #53)", () => {
  it("reports '&&' inside a character class, which means two things at once", () => {
    // `[a&&b]` compiles under both flags: `{a, &, b}` under `u`, and the
    // intersection of `{a}` and `{b}` (empty, so unmatchable) under `v`.
    expect(new RegExp("[a&&b]", "u").test("&")).toBe(true);
    expect(new RegExp("[a&&b]", "v").test("&")).toBe(false);
    expect(classSetAmbiguity("^[a&&b]+$")).toBe("&&");
  });

  it("reports '--' inside a character class", () => {
    // `[!--0]` is the range `!`..`-` plus `0` under `u`, and a class-set
    // difference under `v`. Both compile, so nothing downstream complains.
    expect(classSetAmbiguity("^[!--0]+$")).toBe("--");
  });

  it("is silent for a single occurrence of either character", () => {
    expect(classSetAmbiguity("^[a&b]+$")).toBeUndefined();
    expect(classSetAmbiguity("^[a-z-]+$")).toBeUndefined();
  });

  it("is silent outside a character class, where neither flag reads an operator", () => {
    expect(classSetAmbiguity("^a&&b$")).toBeUndefined();
  });

  it("is silent for an escaped pair, which is literal under both flags", () => {
    expect(classSetAmbiguity("^[a\\-\\-b]+$")).toBeUndefined();
  });

  it("is silent for a pattern that does not compile under 'v' at all", () => {
    // No second reading to disagree with: the render-time normalize-or-omit
    // path (issue #52) owns this case, not the ambiguity advisory.
    expect(new RegExp("[a&&b-]", "u").source).toBe("[a&&b-]");
    expect(() => new RegExp("[a&&b-]", "v")).toThrow();
    expect(classSetAmbiguity("[a&&b-]")).toBeUndefined();
  });

  it("returns only the operator it found, never the pattern", () => {
    expect(classSetAmbiguity("^[s&&t]+$")).toBe("&&");
  });
});
