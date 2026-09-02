import { describe, expect, it } from "vitest";

import {
  SAFE_PATTERN_MAX_BOUND,
  SAFE_PATTERN_MAX_COMPOSITE_BOUND,
  SAFE_PATTERN_MAX_LENGTH,
  checkSafePattern,
  classSetAmbiguity,
  compilesUnderV,
  isSafePattern,
  toVSafePattern,
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

/**
 * Compile a pattern through a variable rather than a literal.
 *
 * The subject of these tests is a pattern the two regex flags read differently,
 * which is by construction something ESLint's `no-invalid-regexp` and sonarjs's
 * duplicate-character-class rules exist to flag. Passing the source through a
 * binding keeps the assertions honest - they still run the real engine - while
 * leaving nothing for a static rule to misread as a defect.
 */
function compiled(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags);
}

/** The corpus of divergent patterns, named so the assertions read as prose. */
const AMBIGUOUS_AMP = "[a&&b]";
/** `&&` in a class that `v` refuses outright, so there is no second reading. */
const V_INVALID_AMP = "[a&&b-]";

describe("classSetAmbiguity (issue #53)", () => {
  it("reports '&&' inside a character class, which means two things at once", () => {
    // Compiles under both flags: `{a, &, b}` under `u`, and the intersection of
    // `{a}` and `{b}` (empty, so unmatchable) under `v`.
    expect(compiled(AMBIGUOUS_AMP, "u").test("&")).toBe(true);
    expect(compiled(AMBIGUOUS_AMP, "v").test("&")).toBe(false);
    expect(classSetAmbiguity(`^${AMBIGUOUS_AMP}+$`)).toBe("&&");
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
    // No browser reading to disagree with: the render-time normalize-or-omit
    // path (issue #52) owns this case, not the ambiguity advisory.
    expect(compiled(V_INVALID_AMP, "u").source).toBe(V_INVALID_AMP);
    expect(() => compiled(V_INVALID_AMP, "v")).toThrow();
    expect(classSetAmbiguity(V_INVALID_AMP)).toBeUndefined();
  });

  it("is silent for a pattern that does not compile under 'u' at all", () => {
    // The mirror case, and the one the guard was added for: `\q{...}` is
    // `v`-only syntax, so this has a browser reading and no kernel reading. The
    // `&&` inside it is unambiguously the intersection operator, and naming a
    // divergence would name one from a reading that does not exist.
    // `compileDraft` never reaches here with such a pattern (checkSafePattern
    // compiles under `u` first), but this is a public export.
    const U_INVALID_AMP = "[\\q{ab}&&\\q{cd}]";
    expect(() => compiled(U_INVALID_AMP, "u")).toThrow();
    expect(compiled(U_INVALID_AMP, "v").source).toBe(U_INVALID_AMP);
    expect(classSetAmbiguity(U_INVALID_AMP)).toBeUndefined();
  });

  it("returns only the operator it found, never the pattern", () => {
    expect(classSetAmbiguity("^[s&&t]+$")).toBe("&&");
  });
});

/**
 * The three patterns this repository's own fixtures carry that a browser
 * refuses (issue #53). They are named here rather than read off disk because
 * this is the kernel's test and two of the three files belong to other
 * packages; the API's boundary test posts the same three fresh, which is what
 * proves reject-new-only actually bites.
 */
const FIXTURE_V_INVALID: readonly { readonly where: string; readonly pattern: string }[] = [
  {
    where: "core fixtures/questions/valid/short-text.json",
    pattern: "^[A-Za-z][A-Za-z .,'-]{0,99}$",
  },
  {
    where: "a2ui-compiler fixtures/corpus/questions/q-msg-plate.json",
    pattern: "^[A-Z0-9][A-Z0-9-]{2,7}$",
  },
  { where: "api e2e/support/fixtures/q-am-plate.json", pattern: "^[A-Z0-9][A-Z0-9-]{2,7}$" },
];

describe("compilesUnderV and toVSafePattern (issues #52, #53)", () => {
  it.each(FIXTURE_V_INVALID)("$where is refused by a browser's compiler", ({ pattern }) => {
    // These parse and serve perfectly well; a browser is what rejects them.
    expect(checkSafePattern(pattern)).toBeUndefined();
    expect(compilesUnderV(pattern)).toBe(false);
  });

  it.each(FIXTURE_V_INVALID)(
    "$where has a v-safe spelling with the same meaning",
    ({ pattern }) => {
      const suggestion = toVSafePattern(pattern);
      expect(suggestion).toBeDefined();
      expect(suggestion).not.toBe(pattern);
      expect(compilesUnderV(suggestion as string)).toBe(true);
      // Same matched set: the rewrite only escapes literals `v` reserves.
      const before = compiled(pattern, "u");
      const after = compiled(suggestion as string, "u");
      for (const sample of ["Ann-Marie O'Neil", "ABC-123", "", "-", "a", "ZZ9"]) {
        expect(after.test(sample)).toBe(before.test(sample));
      }
    },
  );

  it("returns a pattern a browser already accepts byte-identical", () => {
    // The guarantee that keeps a working `&&` intersection from being rewritten.
    expect(toVSafePattern("^[a-z]{2,10}$")).toBe("^[a-z]{2,10}$");
    expect(toVSafePattern(AMBIGUOUS_AMP)).toBe(AMBIGUOUS_AMP);
  });

  it("gives up rather than guess when the rewrite would not be provably safe", () => {
    // A mid-class dash is a range operator under `u`, so escaping it could
    // change the matched set. Omission is the correct degradation: the API is
    // the validation authority (R2), a wrong pattern is not.
    expect(compilesUnderV("^[a-z-A]+$")).toBe(false);
    expect(toVSafePattern("^[a-z-A]+$")).toBeUndefined();
  });

  it("escapes a doubled punctuator that only 'v' reserves", () => {
    const suggestion = toVSafePattern("^[a!!b-]+$");
    expect(suggestion).toBe("^[a\\!\\!b\\-]+$");
  });

  it("leaves an already-escaped character alone", () => {
    expect(toVSafePattern("^[\\]\\-a-z^]{1,20}$")).toBe("^[\\]\\-a-z^]{1,20}$");
  });
});
