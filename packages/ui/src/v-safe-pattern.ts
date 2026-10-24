/**
 * v-safe HTML `pattern` normalization.
 *
 * A question's validation regex is authored against JavaScript's `u` semantics and the
 * compiler copies it verbatim into the document, but browsers compile the HTML `pattern`
 * attribute with the `v` flag, whose character-class grammar is strictly narrower: a
 * bare `-` at the edge of a class is a `SyntaxError` under `v` though it is a plain
 * literal under `u`. The browser then logs an error and drops native validation.
 *
 * The invariant here is that every emitted pattern compiles under `new RegExp(p, "v")`.
 * It is applied at render time rather than by the compiler, because stored A2UI is
 * immutable and served forever (R1, ADR-18), so published documents keep their original
 * pattern whatever the compiler does later.
 *
 * Normalize when the rewrite is provably semantics-preserving, otherwise omit: the API
 * is the validation authority (R2), so a missing native hint is correct degradation
 * while a rejected `pattern` loses the hint and logs an error too.
 *
 * A pattern that already compiles under `v` is returned byte-identical, so the `&&` and
 * `--` class-set operators `v` gives meaning to are never perturbed.
 */

/**
 * `ClassSetSyntaxCharacter`s (v mode) that are ordinary literals inside a `u`-mode
 * character class, and that both modes accept in escaped form. `-`, `\` and `]`
 * need positional reasoning and are handled by the scanner instead.
 */
const CLASS_SYNTAX_LITERALS: ReadonlySet<string> = new Set(["(", ")", "[", "{", "}", "/", "|"]);

/**
 * `ClassSetReservedDoublePunctuator`s (v mode): reserved only when doubled, e.g.
 * `[a!!b]`. Each is a literal in a `u`-mode class and each is escapable under `v`.
 * `&` is in this set but only ever reached for a pattern that already fails under
 * `v`, so the valid `&&` intersection operator is never rewritten.
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
 * Re-spells one element of a character class, read with `u`-mode semantics, so that `v`
 * accepts it unchanged in meaning. Every branch is a literal-to-escaped-literal
 * substitution, so the matched set is identical.
 *
 * A `-` is escaped only where `u` makes it unambiguously a literal rather than a range
 * operator. Any other `-` is left alone, so an exotic mid-class dash falls through to
 * omission rather than risking a silent change of meaning.
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
