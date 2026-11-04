// @ts-check
/**
 * Only a2ui/ is the byte-for-byte upstream copy; its siblings are QCMS-owned source and must remain covered
 * by every gate.
 */

/**
 * Keep the trailing slash so a sibling such as a2ui-legacy/ cannot inherit the vendored exemption.
 */
export const VENDORED_SOURCE_PREFIX = "packages/ui/src/components/a2ui/";

export const VENDORED_SOURCE_PATHSPEC = `:!${VENDORED_SOURCE_PREFIX}**`;

export const VENDORED_SOURCE_PATTERN = new RegExp(
  `^${VENDORED_SOURCE_PREFIX.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
);

/**
 * @param {string} file
 * @returns {boolean}
 */
export function isVendoredSource(file) {
  return file.startsWith(VENDORED_SOURCE_PREFIX);
}
