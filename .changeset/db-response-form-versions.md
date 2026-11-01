---
"@roonga/qcms-db": minor
---

`responseFormVersions` reports the versions one form's non-erased responses carry, in one
environment, newest first. It reads the erasure-safe projection and never the form
definition, so a caller holding no `form: read` can still be told which versions its own
export may name.
