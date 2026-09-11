---
"@roonga/qcms-ui": patch
"create-qcms-app": patch
---

Move the jsdom test environment from `^26.1.0` to `^30.0.1`, deliberately (issue #113).

Nothing a consumer of `@roonga/qcms-ui` can call changes: jsdom is a `devDependency` and
`vitest.setup.ts` is outside the published `files` list, so the package's runtime
dependencies, its API and its rendered output are all untouched. What moves in the
tarball is one line of the published manifest's `devDependencies`.

For `create-qcms-app` the change is real and shipped: the scaffolded admin's own
`devDependencies` carry the same bump, so a newly scaffolded project gets jsdom 30 for
its component tests rather than 26.

Two behaviour differences are worth knowing if you run component tests against this
package's conventions. jsdom now implements custom-property inheritance, so
`getComputedStyle(descendant).getPropertyValue("--token")` resolves the value a themed
ancestor sets instead of returning the empty string, and an unset CSS **longhand** now
resolves to its initial value (`min-height` reads `auto`, not `""`) while an unset
shorthand still reads `""`. jsdom also ships `CSS.escape()` and `CSS.supports()` natively
now, so a conditional react-aria shim for them is inert rather than overriding.

jsdom 30 declares `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"`, which raises the
floor for running this repository's test suites to Node 24.15.0.
