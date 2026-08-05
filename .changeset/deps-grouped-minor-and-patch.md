---
"@qcms/db": patch
"@qcms/ui": patch
---

Dependency maintenance (Dependabot grouped minor/patch). `@qcms/db`: the `@types/pg`
dev range moves to `^8.20.3`. `@qcms/ui`: `@internationalized/date` moves to
`^3.12.3`, and the `@types/react` / `@types/react-dom` dev ranges to `^19.2.18` /
`^19.2.4`. No API or behavior change in either package; consumers resolve newer
in-range versions of these dependencies.

The `react-aria-components` bump offered in the same group is deliberately not taken.
Under 1.20.0 a `Table` row that receives focus before the table has hydrated never
becomes interactive again: it never gains `data-focused` and never fires
`onRowAction`, for the rest of that page load. `@qcms/ui` therefore stays on
`^1.19.0`, which does not have that behaviour.
