/**
 * Read the text out of a `renderToStaticMarkup` string (issue 519).
 *
 * ## Why this is a scanner and not a regex
 *
 * It was `markup.replaceAll(/<[^<>]+>/g, "")`, and CodeQL flagged that as
 * `js/incomplete-multi-character-sanitization` in both files that carried it. The finding
 * is correct and the counterexample is small: a single pass over `<<b>script>` matches the
 * inner `<b>`, removes it, and the two halves close up into `<script>`. One pass cannot be
 * enough for a delimiter that can be reassembled by its own removal, so the shape has to
 * change rather than the pattern.
 *
 * Looping the replace to a fixpoint is the textbook answer and would also be correct, but
 * it asks a reader to reason about convergence to convince themselves the output is safe.
 * A scanner makes the property structural instead: this function only ever appends slices
 * that end before a `<`, or the tail after the last `>`, so
 *
 *   **the returned string cannot contain `<`, for any input at all.**
 *
 * That is the invariant `markup.test.ts` pins directly, including CodeQL's own
 * counterexample, rather than pinning the two or three shapes the callers happen to pass
 * today. There is precedent for preferring the scanner in this tree: issue 557 dropped a
 * regex for a hand-written walk over the same class of finding.
 *
 * An unterminated `<` consumes the rest of the string. That is deliberate and is what
 * makes the invariant total rather than almost-total: half a tag is not text, and emitting
 * its remainder would put the delimiter back into the output on exactly the malformed
 * input the rule is about.
 *
 * Test-only, and deliberately dependency-free: it imports nothing, so it cannot trip
 * either import-surface scan over `components/`, and its callers do their own asserting.
 */
export function stripTags(markup: string): string {
  const text: string[] = [];
  let index = 0;
  for (;;) {
    const open = markup.indexOf("<", index);
    // No `<` left: everything from here is text, by definition of indexOf returning -1.
    if (open === -1) {
      text.push(markup.slice(index));
      return text.join("");
    }
    // Everything up to that `<` is text, and holds no `<` because this is the first one.
    text.push(markup.slice(index, open));
    const close = markup.indexOf(">", open + 1);
    if (close === -1) return text.join("");
    index = close + 1;
  }
}
