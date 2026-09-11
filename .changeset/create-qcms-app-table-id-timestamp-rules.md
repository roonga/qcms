---
"create-qcms-app": minor
---

Carry the admin's one id rendering and one timestamp path into the scaffolding templates
(issue #582).

A scaffolded admin now ships `components/entity-id.tsx`, its copy control and the
`lib/entity-id.ts` rule that decides between §2's prefix-plus-eight for an opaque id and
whole for a derived one, with every table's identifying cell already through it, plus the
operator-zone day formatter and `OperatorDay` component that put a scaffolded project's
day-only table columns on the reader's own calendar day. Its own
changeset is a separate file rather than a second name in the admin's, because
`.changeset/config.json` ignores the private apps and a changeset may not mix an ignored
package with a published one.

The templates are generated from `apps/` by `pnpm qcms:sync-templates`, so this is that
sync rather than a second implementation.
