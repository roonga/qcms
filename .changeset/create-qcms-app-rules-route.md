---
"create-qcms-app": minor
---

Carry the admin's rules route into the scaffolding templates (issue #669).

A scaffolded admin now ships `/forms/{formId}/rules`, the builder's read-only rules lens,
and the route-carrying rule anchors that make the split safe. Its own changeset is a
separate file rather than a second name in the admin's, because `.changeset/config.json`
ignores the private apps and a changeset may not mix an ignored package with a published
one - the release plan refuses to assemble.

The templates are generated from `apps/` by `pnpm qcms:sync-templates`, so this is that
sync rather than a second implementation.
