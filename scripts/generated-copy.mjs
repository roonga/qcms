// @ts-check
/**
 * The one definition of "a generated copy of source that lives somewhere else".
 *
 * `packages/create-qcms-app/templates/` is derived from `apps/` by
 * `pnpm qcms:sync-templates` and committed, because the published tarball has to carry
 * it. Every file in it is byte-identical to a file this repository already lints,
 * type-checks and tests at the source, and `pnpm check:templates` is what proves that
 * rather than asserts it.
 *
 * The tree is therefore SOURCE-SHAPED DATA. It contains real `import` statements, real
 * `@roonga/qcms-*` specifiers and real JSX, and none of it is code this package runs, compiles
 * or lints: `packages/create-qcms-app/tsconfig.json` includes `src`, `scripts` and
 * `e2e` and nothing else, its `lint` script names the same three, and
 * `eslint.config.js` ignores the tree globally. A scanner that reads the tree as code
 * is reading a photograph of a program.
 *
 * That distinction is deliberately NOT folded into `scripts/vendored-source.mjs`. The
 * vendored a2ra components are the opposite case: upstream-owned but genuinely
 * compiled, so a gate that skipped them would be skipping real code. Widening one
 * definition to cover both would give four gates the wrong answer, which is the defect
 * issue #775 closed one directory over. Two concepts, two modules, one spelling each.
 *
 * A gate that excludes this tree owes a reason for the exclusion, and the reason is
 * never "it is big" or "it is noisy". It is that the file is not on the path the gate's
 * subject actually takes.
 */

/**
 * The generated tree, repo-relative, with its trailing slash.
 *
 * The slash is load-bearing: without it a sibling named `templates-static/` would
 * inherit the exemption by prefix, and that one IS hand-written source.
 */
export const GENERATED_COPY_PREFIX = "packages/create-qcms-app/templates/";

/**
 * True for a file inside the generated copy tree.
 *
 * @param {string} file repo-relative POSIX path.
 * @returns {boolean}
 */
export function isGeneratedCopy(file) {
  return file.startsWith(GENERATED_COPY_PREFIX);
}
