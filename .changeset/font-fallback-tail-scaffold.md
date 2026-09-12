---
"create-qcms-app": patch
---

Scaffolded apps name a font token instead of restating a fallback stack (issue #27).

The portal's `body` rule, the QCMS app's respondent preview island, its rule-value chip
and its condition editor each carried their own copy of a fallback list, none of which
matched the token's. They now name `var(--font-portal)` or `var(--font-mono)` with no
inline fallback, and `apps/admin/app/theme.css` ends `--font-admin` in
`var(--font-fallback-sans)`. `adopter-theme.css` documents the tail tokens as the
override surface a deployment uses to add a face for its own audience.
