---
"@qcms/db": patch
"@qcms/ui": patch
---

Dependency maintenance (Dependabot grouped minor/patch). `@qcms/db`: the `@types/pg`
dev range moves to `^8.20.3`. `@qcms/ui`: `@internationalized/date` moves to
`^3.12.3`, and the `@types/react` / `@types/react-dom` dev ranges to `^19.2.18` /
`^19.2.4`. No API or behavior change in either package; consumers resolve newer
in-range versions of these dependencies.

The `react-aria-components` bump offered in the same group was deferred out of this
release, on a reading of a red admin suite that #419 has since corrected: 1.20.0 does
not leave a `Table` row permanently inert. The node that never activated was a
pre-hydration row the spec had focused before the adopting re-render replaced it, a
race that predates 1.20.0 and is widened by it rather than created (and widened
independently by `next` 16.3.0). Waiting for `data-focused` on the already-focused
node cannot recover from it, which is why the deferral looked justified; re-focusing
until the attribute appears on a live row does. With the spec doing that, the bump
is taken in the following release.
