// @ts-check
/**
 * The generated template tree is source-shaped DATA: real imports and real JSX that
 * this package neither runs, compiles nor lints, each byte-identical to a file already
 * checked at its source. Kept separate from `vendored-source.mjs`, which is the
 * opposite case: upstream-owned but genuinely compiled.
 */

/**
 * The generated tree, repo-relative, with its trailing slash.
 *
 * The slash is load-bearing: without it a sibling named `templates-static/` would
 * inherit the exemption by prefix, and that one IS hand-written source.
 */
export const GENERATED_COPY_PREFIX = "packages/create-qcms-app/templates/";

export function isGeneratedCopy(file) {
  return file.startsWith(GENERATED_COPY_PREFIX);
}
