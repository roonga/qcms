---
"create-qcms-app": minor
---

Scaffolded apps get the one rail frame and its anatomy (`plan/admin-design-contracts.md`
§7.0, Code Owner 2026-10-24; issue #1116).

A scaffolded admin shipped three rails that looked alike and behaved differently - the form
subtree's navigating between routes, the Settings one switching panels of a single route, and
the question detail's doing both and holding its lifecycle actions too - each a separate
component with a separate contract. The templates now carry one frame with five ordered parts
(Header, Sections, Children, Filters, Actions), an `<aside>` named for its subject, a Header
whose back link replaces the content-column breadcrumb, one current-row mark that demotes the
parent of the current row, rail rows as anchors rather than buttons, and the question screen's
Publish and Deprecate in its own heading row beside Save rather than in the rail.
