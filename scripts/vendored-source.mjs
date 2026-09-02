// @ts-check
/**
 * The one definition of "vendored" this repository has (issue #775).
 *
 * `packages/ui/src/components/` holds two different kinds of code and the gates used to
 * disagree about which. The `a2ui/` subtree is the byte-for-byte upstream copy vendored
 * by `@a2ra/cli` (ADR-22): it is not ours to edit, so a gate that demanded a change
 * there would be demanding something the repository cannot do. Its four siblings -
 * `submit/`, `schema/`, `form-state/` and `action-context/` - are ordinary QCMS source
 * that happens to live next door.
 *
 * `check-lint-coverage.mjs` drew that line correctly and every other scanning gate
 * excluded the whole `components/` directory instead, on the grounds that it was
 * vendored. Four of them therefore never read a QCMS-owned file, and the em dash in
 * `schema/node.ts` sat there through every green `check:no-em-dash` run since the file
 * was written. An exclusion nobody re-derives is indistinguishable from coverage, which
 * is why the prefix now lives in one module rather than in five spellings of it.
 *
 * Three spellings are exported because the callers genuinely need three: a `git
 * ls-files` pathspec, a path predicate, and a regular expression. All three are built
 * from {@link VENDORED_SOURCE_PREFIX}, so widening or moving the vendored tree is a
 * one-line edit here and nowhere else.
 */

/**
 * The vendored subtree, repo-relative, with its trailing slash.
 *
 * The slash is load-bearing: without it a sibling named `a2ui-legacy/` would inherit the
 * exemption by prefix, which is the leak this module exists to remove.
 */
export const VENDORED_SOURCE_PREFIX = "packages/ui/src/components/a2ui/";

/** The same prefix as a `git ls-files` exclusion pathspec. */
export const VENDORED_SOURCE_PATHSPEC = `:!${VENDORED_SOURCE_PREFIX}**`;

/**
 * The same prefix as an anchored pattern, for gates that filter an already-enumerated
 * list rather than asking git to exclude it.
 *
 * Built by escaping the constant rather than by writing the path a second time: a
 * regular expression literal here would be the fifth copy, which is the defect.
 */
export const VENDORED_SOURCE_PATTERN = new RegExp(
  `^${VENDORED_SOURCE_PREFIX.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
);

/**
 * Whether a repo-relative path is inside the byte-for-byte upstream copy.
 *
 * @param {string} file repo-relative path, slash-separated, as git reports it.
 * @returns {boolean}
 */
export function isVendoredSource(file) {
  return file.startsWith(VENDORED_SOURCE_PREFIX);
}
