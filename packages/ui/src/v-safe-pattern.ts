/**
 * v-safe HTML `pattern` normalization. A validation regex is authored under `u` semantics, but browsers compile
 * the HTML `pattern` with `v`, where a bare `-` at a class edge is a `SyntaxError`. Applied at render time because
 * stored A2UI is immutable (R1, ADR-18): normalize when provably semantics-preserving, otherwise omit (R2).
 */

/**
 * `ClassSetSyntaxCharacter`s (v mode) that are ordinary literals inside a `u`-mode
 * character class, and that both modes accept in escaped form. `-`, `\` and `]`
 * need positional reasoning and are handled by the scanner instead.
 */
const CLASS_SYNTAX_LITERALS: ReadonlySet<string> = new Set(["(", ")", "[", "{", "}", "/", "|"]);

/**
 * `ClassSetReservedDoublePunctuator`s (v mode): reserved only when doubled, e.g. `[a!!b]`; literal under `u`,
 * escapable under `v`. `&` is reached only for a pattern already failing under `v`, so a valid `&&` is never rewritten.
 */
const DOUBLE_PUNCTUATORS: ReadonlySet<string> = new Set([..."&!#$%*+,.:;<=>?@^`~"]);

/** True when the browser's `pattern` compiler (the `v` flag) would accept `pattern`. */
export function compilesUnderV(pattern: string): boolean {
  try {
    new RegExp(pattern, "v");
    return true;
  } catch {
    return false;
  }
}

interface Rewrite {
  readonly text: string;
  /** How many input characters this span consumed. */
  readonly consumed: number;
}

/**
 * Re-spells one element of a character class, read with `u` semantics, so `v` accepts it unchanged in meaning;
 * every branch is a literal-to-escaped-literal substitution. A `-` is escaped only where `u` makes it
 * unambiguously a literal; any other falls through to omission rather than risk a change of meaning.
 */
function rewriteClassElement(pattern: string, i: number, atClassStart: boolean): Rewrite {
  const ch = pattern[i];
  if (ch === "-") {
    const isLiteral = atClassStart || pattern[i + 1] === "]";
    return { text: isLiteral ? "\\-" : "-", consumed: 1 };
  }
  if (CLASS_SYNTAX_LITERALS.has(ch)) {
    return { text: `\\${ch}`, consumed: 1 };
  }
  if (DOUBLE_PUNCTUATORS.has(ch) && pattern[i + 1] === ch) {
    return { text: `\\${ch}\\${ch}`, consumed: 2 };
  }
  return { text: ch, consumed: 1 };
}

/**
 * Walks the pattern with `u`-mode semantics. Text outside a character class is copied
 * verbatim, because the class grammar is the only place `u` and `v` literal spellings
 * diverge.
 */
function escapeVReservedInClasses(pattern: string): string {
  let out = "";
  let inClass = false;
  // True while the next character occupies the class's first-element position,
  // where `u` mode reads `-` as a literal.
  let atClassStart = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      // An already-escaped character, or a class escape: both modes agree.
      out += pattern.slice(i, i + 2);
      i += 2;
      atClassStart = false;
    } else if (!inClass) {
      // A negation caret is not an element, so the first-element position follows it.
      const negated = ch === "[" && pattern[i + 1] === "^";
      out += negated ? "[^" : ch;
      i += negated ? 2 : 1;
      inClass = ch === "[";
      atClassStart = inClass;
    } else if (ch === "]") {
      inClass = false;
      out += ch;
      i += 1;
    } else {
      const { text, consumed } = rewriteClassElement(pattern, i, atClassStart);
      out += text;
      i += consumed;
      atClassStart = false;
    }
  }
  return out;
}

/**
 * Maps a compiled document's `pattern` prop to a value safe to put on the DOM, or
 * `undefined` to omit the attribute. The result is either `undefined` or a string that
 * compiles under `new RegExp(result, "v")`.
 */
export function toVSafePattern(pattern: string | undefined): string | undefined {
  if (pattern === undefined) return undefined;
  if (compilesUnderV(pattern)) return pattern;
  const normalized = escapeVReservedInClasses(pattern);
  if (normalized !== pattern && compilesUnderV(normalized)) return normalized;
  return undefined;
}
