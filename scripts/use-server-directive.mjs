/**
 * A linear scan, not a regex: the obvious pattern backtracks exponentially on a long run of comment
 * characters. Whitespace must stay the full `\s` set, so a BOM, no-break space or form feed still declares the directive.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function declaresUseServer(source) {
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    // One character at a time, so `\s` has nothing to backtrack over.
    if (char !== undefined && /\s/.test(char)) {
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
