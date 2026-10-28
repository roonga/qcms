/**
 * A linear scan rather than a regular expression: the obvious pattern can split a run
 * of comment characters exponentially many ways and hangs on a long one.
 *
 * Whitespace must stay the full `\s` set. A module opening with a BOM, a no-break
 * space, a form feed or a paragraph separator still declares the directive, and under a
 * narrower set it would read as declaring nothing, putting a real Server Action out of
 * the enumerating gate's reach.
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
