/**
 * Whether a module's FIRST statement is the `"use server"` directive (task 073).
 *
 * Three scans need this: the origin-guard gate enumerates every Server Action across both
 * Next apps, the portal's belt-log test holds each one to a `BeltRoute`, and its
 * import-surface test walks the component graph out of each one. All three used to carry
 * the same expression, which is why it lives here.
 *
 * **It is a scan and not a regular expression, and that is the point.** The obvious
 * pattern, `/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/`, backtracks
 * exponentially: the alternation can split one run of comment characters in exponentially
 * many ways, so a file whose head is a long run of block-comment opens and closes hangs the
 * matcher. CodeQL flagged all three copies on PR #1034 (alerts 22, 23 and 24). The input
 * here is the repository's own source, so the exposure was a slow gate rather than a
 * vulnerability, but a linear walk is the same number of lines and removes the question.
 *
 * It reads exactly what the expression claimed to: leading whitespace and leading line or
 * block comments are skipped, and the first thing that is neither has to be the directive.
 * A mention of `"use server"` anywhere further down the file is not one, which is the
 * whole distinction these scans need.
 *
 * @param {string} source The module's full text.
 * @returns {boolean} True when the directive is the module's first statement.
 */
export function declaresUseServer(source) {
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index);
      // A file that is nothing but one line comment declares no directive.
      if (newline === -1) return false;
      index = newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const close = source.indexOf("*/", index + 2);
      // An unterminated block comment leaves no statement after it.
      if (close === -1) return false;
      index = close + 2;
      continue;
    }
    return source.startsWith('"use server"', index) || source.startsWith("'use server'", index);
  }
  return false;
}
