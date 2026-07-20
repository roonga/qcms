---
"@qcms/db": minor
---

Add `getFormBySlug`, a shape-preserving read helper that resolves a form
identity from its public slug. The anonymous start-session path (018) needs to
map a respondent-supplied slug to a form before checking status and selecting
the newest published version.
