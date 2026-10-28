// @ts-check
/**
 * The one definition of "vendored", so no gate can draw the line itself. Only the
 * `a2ui/` subtree is the byte-for-byte upstream copy (ADR-22); its siblings are
 * ordinary QCMS source, and excluding the parent directory hid them from four gates.
 */

/**
 * The vendored subtree, repo-relative, with its trailing slash.
 *
 * The slash is load-bearing: without it a sibling named `a2ui-legacy/` would inherit the
 * exemption by prefix, which is the leak this module exists to remove.
 */
export const VENDORED_SOURCE_PREFIX = "packages/ui/src/components/a2ui/";

export const VENDORED_SOURCE_PATHSPEC = `:!${VENDORED_SOURCE_PREFIX}**`;

export const VENDORED_SOURCE_PATTERN = new RegExp(
  `^${VENDORED_SOURCE_PREFIX.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
);

export function isVendoredSource(file) {
  return file.startsWith(VENDORED_SOURCE_PREFIX);
}
