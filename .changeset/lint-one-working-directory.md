---
"@roonga/qcms-a2ui-compiler": patch
"@roonga/qcms-core": patch
"@roonga/qcms-csv": patch
"@roonga/qcms-db": patch
"@roonga/qcms-observability": patch
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Every `lint` script runs ESLint with one working directory (issue #899).

No shipped code changed. Each package's `lint` script now reads
`node ../../scripts/eslint-workspace.mjs src` instead of `eslint src`, which is the same
ESLint with the working directory pinned to the repository root, and that is the whole
difference.

It is here because a lint verdict was not a property of the file. ESLint hands each rule a
`context.cwd`, and `eslint-plugin-sonarjs` resolves against it: 14 of its rules switch on
only when a test framework is declared in a `package.json` at or above the linted file, and
that upward search stops at the working directory. This repository declares `vitest` and
`@playwright/test` in the root manifest alone, so from a package directory the search found
neither and all 14 returned an empty visitor. The root sweep saw two real errors in
`apps/portal/e2e/clear-paths.pw.ts` that `turbo run lint`, which runs each package script
in the package directory, could not.

`pnpm check:lint-coverage` now fails a lint script that reaches ESLint unpinned, and
`scripts/eslint-workspace.test.ts` lints one fixture from two directories and demands
identical output, so neither half can regress quietly.
