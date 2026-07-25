/**
 * v-safe HTML `pattern` normalization (issue #29).
 *
 * A question's `shortText` validation regex is authored and validated against
 * JavaScript's `u` (or no-flag) regex semantics, and the compiler copies it
 * verbatim into the A2UI document's `TextField.pattern` prop. Browsers, however,
 * compile the HTML `pattern` attribute with the **`v`** flag, whose character-class
 * grammar is strictly narrower: a bare `-` at the edge of a class (`[A-Za-z .,'-]`,
 * which occurs throughout the corpus) is a `SyntaxError` under `v` even though it
 * is a plain literal under `u`. The browser then logs
 * "Pattern attribute value ... is not a valid regular expression" and silently
 * drops native client-side validation.
 *
 * This module holds the invariant that no `pattern` value reaching the DOM can
 * produce that error: **every emitted pattern compiles under `new RegExp(p, "v")`.**
 * It is applied by the qcms-owned `TextFieldField` adapter in `registry.tsx`, not
 * by the compiler: stored A2UI is immutable and served forever (R1, ADR-18), so
 * documents already published keep their original `pattern` string whatever the
 * compiler does later. The renderer is the only layer that sees every document.
 *
 * Two-step policy, in order:
 *
 * 1. **Normalize** when the rewrite is provably semantics-preserving: escape the
 *    characters `v` reserves inside a character class but which `u` treats as
 *    ordinary literals there. `[a-z-]` becomes `[a-z\-]`, which denotes exactly
 *    the same set under `v` as the original did under `u`.
 * 2. **Omit** otherwise. The API is the validation authority (R2), so a missing
 *    native hint is correct degradation; a `pattern` the browser rejects is not,
 *    because it both logs an error and loses the hint anyway.
 *
 * A pattern that already compiles under `v` is returned byte-identical: this
 * function never rewrites a working pattern, so it cannot perturb the `&&`/`--`
 * class-set operators that `v` gives meaning to.
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

/**
 * Escapes the character-class literals that `v` mode reserves, reading the source
 * with `u`-mode semantics (which is what the pattern was authored and validated
 * against). Every rewrite is a literal-to-escaped-literal substitution, so the
 * matched set is unchanged; a `-` is only escaped where `u` mode makes it
 * unambiguously a literal rather than a range operator (first element of the
 * class, or last before the closing `]`). Any other `-` is left alone, which
 * means an exotic mid-class dash falls through to omission rather than risking a
 * silent change of meaning.
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
      // Already-escaped source character (or a class escape like `\w`): both modes
      // agree, so copy the pair verbatim.
      out += pattern.slice(i, i + 2);
      i += 2;
      atClassStart = false;
      continue;
    }
    if (!inClass) {
      out += ch;
      if (ch === "[") {
        inClass = true;
        atClassStart = true;
        if (pattern[i + 1] === "^") {
          // A negation caret is not an element; the first-element position is the
          // character after it.
          out += "^";
          i += 1;
        }
      }
      i += 1;
      continue;
    }
    if (ch === "]") {
      inClass = false;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "-") {
      const isLiteral = atClassStart || pattern[i + 1] === "]";
      out += isLiteral ? "\\-" : "-";
      i += 1;
      atClassStart = false;
      continue;
    }
    if (CLASS_SYNTAX_LITERALS.has(ch)) {
      out += `\\${ch}`;
      i += 1;
      atClassStart = false;
      continue;
    }
    if (DOUBLE_PUNCTUATORS.has(ch) && pattern[i + 1] === ch) {
      out += `\\${ch}\\${ch}`;
      i += 2;
      atClassStart = false;
      continue;
    }
    out += ch;
    i += 1;
    atClassStart = false;
  }
  return out;
}

/**
 * Maps a compiled document's `pattern` prop to a value safe to put on the DOM, or
 * `undefined` to omit the attribute.
 *
 * Guarantee: the result is either `undefined` or a string that compiles under
 * `new RegExp(result, "v")`. It is the original string whenever that already
 * holds. Pure and side-effect free.
 */
export function toVSafePattern(pattern: string | undefined): string | undefined {
  if (pattern === undefined) return undefined;
  if (compilesUnderV(pattern)) return pattern;
  const normalized = escapeVReservedInClasses(pattern);
  if (normalized !== pattern && compilesUnderV(normalized)) return normalized;
  return undefined;
}
