---
"@qcms/ui": patch
---

The published `@qcms/ui` tarball no longer carries the package's own tests
(issue #66). `files` kept `src` wholesale, so every `*.test.tsx`/`*.test.ts`
file, the Vitest `__snapshots__` directory, and the `src/test-support/`
helpers shipped to consumers: unintended weight and a confusing public
surface, since none of it is reachable through `exports`.

`files` now adds three negations (`!src/**/*.test.*`,
`!src/**/__snapshots__/**`, `!src/test-support/**`), dropping 12 files from
the tarball (322 to 310). `src` itself stays, because the `./theme.css`
export points at `./src/theme.css` and readable source remains useful to
adopters who vendor from it.

Nothing a consumer can resolve changed: `.` and `./native-submit` still
resolve into `dist/`, `./theme.css` still resolves to `src/theme.css`, and
`a2ra.json` is still present. No source, test, or build behavior was touched.
