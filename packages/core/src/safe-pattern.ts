/**
 * RE2-safe `pattern` subset for shortText constraints (task 003).
 *
 * qcms has no RE2 runtime (no new dependencies — R3); patterns ultimately run
 * on the JavaScript backtracking engine when answers are validated (task 009).
 * So instead of trusting authors, the kernel accepts only a documented subset
 * that cannot backtrack catastrophically, and rejects everything else at
 * definition-parse time.
 *
 * Supported (the documented subset, mirrored in DOMAIN_SCHEMA §2.2):
 * - literals and escaped metacharacters, `.`, anchors `^` `$`, `\b` `\B`
 * - character classes `[...]` / `[^...]` incl. ranges and class escapes
 * - predefined classes `\d \D \w \W \s \S`, unicode escapes `\uXXXX` /
 *   `\u{...}` and properties `\p{...}` / `\P{...}`
 * - alternation `|` and groups `(...)` / `(?:...)` / `(?<name>...)`
 * - quantifiers `* + ? {n} {n,} {n,m}` (greedy or lazy) with bounds <= 1000
 *
 * Rejected as PATTERN_UNSUPPORTED (catastrophic or non-RE2 constructs):
 * - backreferences (`\1`…`\9`, `\k<name>`) and lookahead/lookbehind
 *   assertions — RE2 excludes these because they force backtracking
 * - unbounded quantifiers (`*`, `+`, `{n,}`) applied to a group whose body
 *   contains a quantifier or an alternation (the `(a+)+` / `(a|ab)*` shapes);
 *   bounded repetition of such groups is capped at {..32}
 * - any quantifier bound above 1000, or a pattern longer than 256 chars
 *
 * The composite-group rules are deliberately conservative: some rejected
 * patterns are harmless, but every accepted pattern is linear-time-safe on a
 * backtracking engine. Patterns that fail to compile at all (under the `u`
 * flag) are PATTERN_INVALID.
 */

/** Maximum accepted pattern length, part of the documented subset. */
export const SAFE_PATTERN_MAX_LENGTH = 256;
/** Maximum finite quantifier bound, part of the documented subset. */
export const SAFE_PATTERN_MAX_BOUND = 1000;
/** Maximum bound when repeating a group containing `|` or a quantifier. */
export const SAFE_PATTERN_MAX_COMPOSITE_BOUND = 32;

export type SafePatternIssueCode = "PATTERN_INVALID" | "PATTERN_UNSUPPORTED";

export interface SafePatternIssue {
  readonly code: SafePatternIssueCode;
  readonly message: string;
}

interface GroupFrame {
  /** True when the group body contains an alternation or any quantifier. */
  composite: boolean;
}

function unsupported(message: string): SafePatternIssue {
  return { code: "PATTERN_UNSUPPORTED", message };
}

function invalid(message: string): SafePatternIssue {
  return { code: "PATTERN_INVALID", message };
}

/** Parse a `{n}` / `{n,}` / `{n,m}` quantifier starting at `{`; returns the
 * index just past `}` and the effective maximum (Infinity for `{n,}`). */
function parseBraceQuantifier(
  pattern: string,
  start: number,
): { end: number; max: number } | undefined {
  const close = pattern.indexOf("}", start);
  if (close === -1) {
    return undefined;
  }
  const body = pattern.slice(start + 1, close);
  const match = /^(\d+)(,(\d*)?)?$/.exec(body);
  if (match === null) {
    return undefined;
  }
  const min = Number(match[1]);
  const max =
    match[2] === undefined
      ? min
      : match[3] === undefined || match[3] === ""
        ? Number.POSITIVE_INFINITY
        : Number(match[3]);
  return { end: close + 1, max };
}

/**
 * Check a pattern against the safe subset. Returns `undefined` when the
 * pattern is accepted, otherwise the typed issue. Pure, no I/O.
 */
export function checkSafePattern(pattern: string): SafePatternIssue | undefined {
  if (pattern.length > SAFE_PATTERN_MAX_LENGTH) {
    return unsupported(`Pattern exceeds ${SAFE_PATTERN_MAX_LENGTH} characters`);
  }
  try {
    // Compilability gate. The `u` flag also enforces strict syntax (no
    // annex-B legacy), so the scanner below only ever sees valid patterns.
    new RegExp(pattern, "u");
  } catch {
    return invalid("Pattern does not compile as a regular expression (unicode mode)");
  }

  // Implicit top-level frame; group frames are pushed on `(`.
  const frames: GroupFrame[] = [{ composite: false }];
  // Set when the previous token was a closed group, so a following
  // quantifier knows whether it repeats a composite body.
  let closedGroupComposite: boolean | undefined;
  let i = 0;

  const current = (): GroupFrame => {
    const frame = frames[frames.length - 1];
    /* v8 ignore next 3 -- bug guard; unbalanced parens cannot compile */
    if (frame === undefined) {
      throw new Error("safe-pattern scanner frame underflow");
    }
    return frame;
  };

  const applyQuantifier = (max: number): SafePatternIssue | undefined => {
    if (Number.isFinite(max) && max > SAFE_PATTERN_MAX_BOUND) {
      return unsupported(`Quantifier bound exceeds ${SAFE_PATTERN_MAX_BOUND}`);
    }
    if (closedGroupComposite === true) {
      if (!Number.isFinite(max)) {
        return unsupported(
          "Unbounded repetition of a group containing '|' or another quantifier is not supported",
        );
      }
      if (max > SAFE_PATTERN_MAX_COMPOSITE_BOUND) {
        return unsupported(
          `Repetition of a group containing '|' or another quantifier is capped at {..${SAFE_PATTERN_MAX_COMPOSITE_BOUND}}`,
        );
      }
    }
    current().composite = true;
    closedGroupComposite = undefined;
    return undefined;
  };

  while (i < pattern.length) {
    const ch = pattern[i];
    switch (ch) {
      case "\\": {
        const next = pattern[i + 1];
        if (next === undefined) {
          return invalid("Pattern ends with a dangling backslash");
        }
        if (next >= "1" && next <= "9") {
          return unsupported("Backreferences are not supported");
        }
        if (next === "k") {
          return unsupported("Named backreferences are not supported");
        }
        if ((next === "p" || next === "P" || next === "u") && pattern[i + 2] === "{") {
          const close = pattern.indexOf("}", i + 2);
          /* v8 ignore next 3 -- bug guard; an unclosed brace escape cannot compile */
          if (close === -1) {
            return invalid("Unterminated brace escape");
          }
          i = close + 1;
        } else {
          i += 2;
        }
        closedGroupComposite = undefined;
        break;
      }
      case "[": {
        // Character classes are single atoms; nothing inside them is regex
        // syntax for our purposes. Skip to the unescaped closing bracket.
        i += pattern[i + 1] === "^" ? 2 : 1;
        while (i < pattern.length && pattern[i] !== "]") {
          i += pattern[i] === "\\" ? 2 : 1;
        }
        /* v8 ignore next 3 -- bug guard; an unclosed class cannot compile */
        if (i >= pattern.length) {
          return invalid("Unterminated character class");
        }
        i += 1; // past "]"
        closedGroupComposite = undefined;
        break;
      }
      case "(": {
        if (pattern[i + 1] === "?") {
          const third = pattern[i + 2];
          if (third === "=" || third === "!") {
            return unsupported("Lookahead assertions are not supported");
          }
          if (third === "<" && (pattern[i + 3] === "=" || pattern[i + 3] === "!")) {
            return unsupported("Lookbehind assertions are not supported");
          }
          // "(?:" or "(?<name>": skip the prefix; named-group names are
          // consumed as ordinary literals, which is harmless.
          i += 3;
        } else {
          i += 1;
        }
        frames.push({ composite: false });
        closedGroupComposite = undefined;
        break;
      }
      case ")": {
        const closed = frames.pop();
        /* v8 ignore next 3 -- bug guard; unbalanced parens cannot compile */
        if (closed === undefined || frames.length === 0) {
          return invalid("Unbalanced group");
        }
        // A composite inner group makes the enclosing body composite too:
        // `((a+)b)*` must be treated exactly like `(a+b)*`.
        if (closed.composite) {
          current().composite = true;
        }
        closedGroupComposite = closed.composite;
        break;
      }
      case "|": {
        current().composite = true;
        closedGroupComposite = undefined;
        i += 1;
        break;
      }
      case "*":
      case "+": {
        const issue = applyQuantifier(Number.POSITIVE_INFINITY);
        if (issue !== undefined) {
          return issue;
        }
        i += pattern[i + 1] === "?" ? 2 : 1; // consume lazy marker
        break;
      }
      case "?": {
        const issue = applyQuantifier(1);
        if (issue !== undefined) {
          return issue;
        }
        i += pattern[i + 1] === "?" ? 2 : 1; // consume lazy marker
        break;
      }
      case "{": {
        const parsed = parseBraceQuantifier(pattern, i);
        /* v8 ignore next 3 -- bug guard; a stray "{" cannot compile in u-mode */
        if (parsed === undefined) {
          return invalid("Malformed bounded quantifier");
        }
        const issue = applyQuantifier(parsed.max);
        if (issue !== undefined) {
          return issue;
        }
        i = parsed.end + (pattern[parsed.end] === "?" ? 1 : 0); // lazy marker
        break;
      }
      default: {
        closedGroupComposite = undefined;
        i += 1;
        break;
      }
    }
    if (ch === ")") {
      i += 1;
    }
  }
  return undefined;
}

/** True when the pattern is inside the documented safe subset. */
export function isSafePattern(pattern: string): boolean {
  return checkSafePattern(pattern) === undefined;
}
