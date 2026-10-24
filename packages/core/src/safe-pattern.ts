// An authored pattern ends up on the JavaScript backtracking engine, so only
// constructs that cannot backtrack catastrophically are accepted; the subset is
// DOMAIN_SCHEMA §2.2. Deliberately conservative: some refused patterns are
// harmless, but every accepted one is linear-time-safe.

/** Maximum accepted pattern length. */
export const SAFE_PATTERN_MAX_LENGTH = 256;
/** Maximum finite quantifier bound. */
export const SAFE_PATTERN_MAX_BOUND = 1000;
/** Maximum bound when repeating a group containing `|` or a quantifier. */
export const SAFE_PATTERN_MAX_COMPOSITE_BOUND = 32;

export type SafePatternIssueCode = "PATTERN_INVALID" | "PATTERN_UNSUPPORTED";

export interface SafePatternIssue {
  readonly code: SafePatternIssueCode;
  readonly message: string;
}

interface GroupFrame {
  // True when the body contains an alternation or any quantifier.
  composite: boolean;
}

function unsupported(message: string): SafePatternIssue {
  return { code: "PATTERN_UNSUPPORTED", message };
}

function invalid(message: string): SafePatternIssue {
  return { code: "PATTERN_INVALID", message };
}

// The maximum is Infinity for an open-ended `{n,}`.
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
    max = min;
  } else if (match[3] === undefined || match[3] === "") {
    max = Number.POSITIVE_INFINITY;
  } else {
    max = Number(match[3]);
  }
  return { end: close + 1, max };
}

/** `undefined` when the pattern is accepted. */
export function checkSafePattern(pattern: string): SafePatternIssue | undefined {
  if (pattern.length > SAFE_PATTERN_MAX_LENGTH) {
    return unsupported(`Pattern exceeds ${SAFE_PATTERN_MAX_LENGTH} characters`);
  }
  try {
    // The `u` flag enforces strict syntax, so the scanner below only sees
    // valid patterns.
    new RegExp(pattern, "u");
  } catch {
    return invalid("Pattern does not compile as a regular expression (unicode mode)");
  }

  const frames: GroupFrame[] = [{ composite: false }];
  // Set when the previous token was a closed group, so a following quantifier
  // knows whether it repeats a composite body.
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
        // A character class is one atom, so nothing inside it is syntax here.
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
          // A named group's name is consumed as literals, harmlessly.
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
        // A composite inner group makes the enclosing body composite too.
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

export function isSafePattern(pattern: string): boolean {
  return checkSafePattern(pattern) === undefined;
}

/**
 * True when a browser's `pattern`-attribute compiler (the `v` flag) accepts
 * this expression. Its character-class grammar is narrower than the `u`
 * semantics patterns are authored against, so a pattern that fails here still
 * validates answers on the server while the browser silently drops the native
 * client-side hint.
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
 * `v`-mode `ClassSetReservedDoublePunctuator`s, reserved only when doubled.
 * Each is a literal in a `u`-mode class and escapable under `v`. `&` is reached
 * only for a pattern that already fails under `v`, so a working `&&`
 * intersection is never rewritten.
 */
const V_RESERVED_WHEN_DOUBLED: ReadonlySet<string> = new Set([..."&!#$%*+,.:;<=>?@^`~"]);

/** Re-spell one class element so `v` reads it exactly as `u` did. */
function respellClassElement(
  ch: string,
  next: string | undefined,
  firstElement: boolean,
): { text: string; width: number } {
  if (ch === "-") {
    // Escaped only where `u` makes it unambiguously a literal. Any other `-`
    // is left alone, so the rewrite cannot change meaning.
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
      // Both modes agree on an escaped pair, so it is copied verbatim.
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
 * none that provably preserves the matched set. A pattern that already compiles
 * under `v` is returned byte-identical, so a working `&&` or `--` class-set
 * operator is never disturbed.
 *
 * This is the authoring-time half. `@roonga/qcms-ui` restates it at render time
 * for stored documents, which keep their original `pattern` forever (R1,
 * ADR-18); that copy is not an import, because the renderer must not pull the
 * kernel into the client bundle, and a test asserts the two agree.
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
 * The silent `u`/`v` divergence inside a character class, or `undefined` when
 * the pattern has none.
 *
 * `[a&&b]` compiles under both flags: under `u` it is the set `{a, &, b}` and
 * under `v` an empty intersection that can never match. Nothing downstream
 * reports it, because both readings are valid regular expressions, so authoring
 * time is the only layer that can raise it. `compileDraft` turns it into a
 * warning rather than a refusal, since the pattern may be what the author meant.
 *
 * Only a pattern that compiles under both flags is reported: a divergence needs
 * two readings to diverge between.
 */
export function classSetAmbiguity(pattern: string): ClassSetOperator | undefined {
  // Both readings have to exist for them to disagree, and this is a public
  // export: `[\q{ab}&&\q{cd}]` is valid under `v` and invalid under `u`, so
  // reporting it would name a divergence from a reading that does not exist.
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
      // An escaped character is a literal under both flags, so `\&\&` is
      // unambiguous and must not be reported.
      i += 2;
      continue;
    }
    if (!inClass) {
      inClass = ch === "[";
      // A negation caret is not an element, so it is stepped past with the
      // bracket.
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
