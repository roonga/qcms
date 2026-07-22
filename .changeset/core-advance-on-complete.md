---
"@qcms/core": minor
---

Reserve an optional per-form `advanceOnComplete` boolean on `FormDefinition`
(ADR-28, task 045, finding H). When set it will let the portal opt in to
auto-advancing as the last required answer of a step lands; it is not yet
honored anywhere (the builder-UI toggle and the behaviour are a later admin
task). The field is optional, so every existing published snapshot parses
unchanged (the field is simply absent, treated as `false`).
