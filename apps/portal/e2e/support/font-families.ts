/**
 * Compare a computed `font-family` against a computed `--font-*` token (issue #27).
 *
 * Both sides need normalizing before they can be compared at all. Chromium
 * re-serializes `font-family` - it quotes a multi-word family and collapses the space
 * after each comma - but returns a custom property's computed value close to how it was
 * authored, and Prettier has reflowed the tail in `packages/ui/src/theme.css` across
 * continuation lines. So the same list reaches a test as two different strings, and
 * "the body resolves to exactly the token" is only an assertion once both are reduced
 * to a list of bare family names.
 *
 * Shared by `apps/portal/e2e/fonts.pw.ts` (body text and the submission reference) and
 * `apps/admin/e2e/forms-builder.pw.ts` (the condition editor's CodeMirror pane), which
 * is why it is a module rather than a local helper in each: the admin suite already
 * imports this support directory for `gates.js`.
 */

/** One computed `font-family` or `--font-*` value, as bare family names in order. */
export function families(computedValue: string): readonly string[] {
  return computedValue
    .replaceAll(/\s+/gu, " ")
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/gu, ""))
    .filter((family) => family !== "");
}
