/**
 * RE2-safe `pattern` subset for shortText constraints (task 003).
 *
 * qcms has no RE2 runtime (no new dependencies - R3); patterns ultimately run
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
 *   assertions - RE2 excludes these because they force backtracking
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
  const match = /^(\d+)(,(\d*))?$/.exec(body);
  if (match === null) {
    return undefined;
  }
  const min = Number(match[1]);
  let max: number;
  if (match[2] === undefined) {
    // Bare `{n}`: exact count.
    max = min;
  } else if (match[3] === undefined || match[3] === "") {
    // Open-ended `{n,}`: no upper bound.
    max = Number.POSITIVE_INFINITY;
  } else {
    // Bounded `{n,m}`.
    max = Number(match[3]);
  }
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

/**
 * True when a browser's `pattern`-attribute compiler (the `v` flag) accepts
 * this expression.
 *
 * Browsers compile the HTML `pattern` attribute with `v`, whose character-class
 * grammar is strictly narrower than the `u` semantics a question's validation
 * regex is authored and validated against: a bare `-` at the edge of a class
 * (`[A-Za-z .,'-]`) is a literal under `u` and a `SyntaxError` under `v`. A
 * pattern that fails here still validates answers correctly on the server, but
 * a browser logs "Pattern attribute value ... is not a valid regular
 * expression" and silently drops the native client-side hint.
 */
export function compilesUnderV(pattern: string): boolean {
  try {
    new RegExp(pattern, "v");
    return true;
  } catch {
    return false;
  }
}

/**
 * `v`-reserved characters that a `u`-mode character class treats as ordinary
 * literals, and that both modes accept escaped. `-`, `\` and `]` need
 * positional reasoning and are handled by the walk instead.
 */
const V_RESERVED_IN_CLASS: ReadonlySet<string> = new Set(["(", ")", "[", "{", "}", "/", "|"]);

/**
 * `v`-mode `ClassSetReservedDoublePunctuator`s: reserved only when doubled
 * (`[a!!b]`). Each is a literal in a `u`-mode class and each is escapable under
 * `v`. `&` is here but is only reached for a pattern that already fails under
 * `v`, so a working `&&` intersection is never rewritten.
 */
const V_RESERVED_WHEN_DOUBLED: ReadonlySet<string> = new Set([..."&!#$%*+,.:;<=>?@^`~"]);

/** Re-spell one class element so `v` reads it exactly as `u` did. */
function respellClassElement(
  ch: string,
  next: string | undefined,
  firstElement: boolean,
): { text: string; width: number } {
  if (ch === "-") {
    // Escape a `-` only where `u` makes it unambiguously a literal: the class's
    // first element, or the last before `]`. Any other `-` is a range operator
    // or an exotic case, and is left alone so the rewrite cannot change meaning.
    const literal = firstElement || next === "]";
    return { text: literal ? "\\-" : "-", width: 1 };
  }
  if (V_RESERVED_IN_CLASS.has(ch)) return { text: `\\${ch}`, width: 1 };
  if (V_RESERVED_WHEN_DOUBLED.has(ch) && next === ch) {
    return { text: `\\${ch}\\${ch}`, width: 2 };
  }
  return { text: ch, width: 1 };
}

/** Rewrite every character class so `v` accepts it with the `u` meaning intact. */
function respellClasses(pattern: string): string {
  let out = "";
  let inClass = false;
  let firstElement = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    /* v8 ignore next 3 -- bug guard; `i < pattern.length` keeps the index in range */
    if (ch === undefined) {
      break;
    }
    if (ch === "\\") {
      // Already escaped: both modes agree, so the pair is copied verbatim.
      out += pattern.slice(i, i + 2);
      i += 2;
      firstElement = false;
    } else if (!inClass) {
      const negated = ch === "[" && pattern[i + 1] === "^";
      out += negated ? "[^" : ch;
      i += negated ? 2 : 1;
      inClass = ch === "[";
      firstElement = inClass;
    } else if (ch === "]") {
      inClass = false;
      out += ch;
      i += 1;
    } else {
      const { text, width } = respellClassElement(ch, pattern[i + 1], firstElement);
      out += text;
      i += width;
      firstElement = false;
    }
  }
  return out;
}

/**
 * The `v`-safe spelling of an authored pattern, or `undefined` when there is
 * none that is provably meaning-preserving (issue #52, issue #53).
 *
 * Two steps, in order. **Normalize** when the rewrite provably preserves the
 * matched set: escape the characters `v` reserves inside a character class that
 * `u` treats as ordinary literals there, so `[a-z-]` becomes `[a-z\-]`, which
 * denotes the same set under `v` as the original did under `u`. **Give up**
 * otherwise, rather than guess.
 *
 * A pattern that already compiles under `v` is returned byte-identical, so this
 * never disturbs a working `&&` or `--` class-set operator.
 *
 * This is the authoring-time half of the rule. `@roonga/qcms-ui` carries its own
 * render-time restatement for stored documents, which are immutable and keep
 * their original `pattern` forever (R1, ADR-18); that copy is deliberately not
 * an import, because the renderer is a browser package that must not pull the
 * kernel into the client bundle - the same seam `AuthorMessagesSchema` records.
 * `packages/ui/src/v-safe-pattern.test.tsx` asserts the two agree.
 */
export function toVSafePattern(pattern: string): string | undefined {
  if (compilesUnderV(pattern)) return pattern;
  const respelled = respellClasses(pattern);
  return respelled !== pattern && compilesUnderV(respelled) ? respelled : undefined;
}

/**
 * The two `v`-mode class-set operators, which are ordinary literals in a
 * `u`-mode character class.
 */
export type ClassSetOperator = "&&" | "--";

/**
 * The silent `u`/`v` divergence inside a character class (issue #53), or
 * `undefined` when the pattern has none.
 *
 * `[a&&b]` compiles under **both** flags. Under `u` it is the set
 * `{a, &, b}`; under `v` it is the intersection of `{a}` and `{b}`, which is
 * empty, so the expression can never match. Nothing reports this: there is no
 * console error and no compile failure, and the kernel validates answers under
 * `u` while a browser compiles the HTML `pattern` attribute under `v`. So the
 * same authored pattern means two different things in two places, and neither
 * of them says so.
 *
 * The renderer structurally cannot detect or repair this - by the time a
 * pattern reaches it, both readings are valid regular expressions - which is
 * why authoring-time validation is the only layer that can raise it at all.
 * `compileDraft` turns the result into a `PATTERN_CLASS_SET_AMBIGUOUS`
 * publish warning; it is a warning rather than a refusal because the pattern
 * is legal and may well be exactly what the author meant.
 *
 * Only patterns that compile under **both** flags are reported, and the guard
 * runs in both directions because a divergence needs two readings to diverge
 * between. One that fails under `v` has no browser reading, and the render-time
 * normalize-or-omit path already owns that case; one that fails under `u` has no
 * kernel reading, which `[\q{ab}&&\q{cd}]` is - `\q{...}` is `v`-only syntax.
 */
export function classSetAmbiguity(pattern: string): ClassSetOperator | undefined {
  // Both readings have to exist for them to disagree. `compileDraft` only ever
  // reaches here with a pattern `checkSafePattern` already compiled under `u`,
  // but this is a public export: `[\q{ab}&&\q{cd}]` is valid under `v` and
  // invalid under `u`, and reporting it would name a divergence from a reading
  // that does not exist.
  try {
    new RegExp(pattern, "u");
    new RegExp(pattern, "v");
  } catch {
    return undefined;
  }

  let inClass = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      // An escaped character is a literal under both flags, so an escaped
      // `\&\&` or `\-\-` is unambiguous and must not be reported.
      i += 2;
      continue;
    }
    if (!inClass) {
      inClass = ch === "[";
      // A negation caret is not an element; step past it with the bracket.
      i += inClass && pattern[i + 1] === "^" ? 2 : 1;
      continue;
    }
    if (ch === "]") {
      inClass = false;
      i += 1;
      continue;
    }
    if ((ch === "&" || ch === "-") && pattern[i + 1] === ch) {
      return ch === "&" ? "&&" : "--";
    }
    i += 1;
  }
  return undefined;
}
