---
"@qcms/db": patch
"@qcms/ui": patch
---

Take the routine dependency bumps from dependabot's group, for the two publishable
packages it touches.

`@qcms/db` moves `pg` from 8.22 to 8.23 and `@types/pg` to 8.23.1. `pg` is a runtime
dependency of this package, so the bump reaches a consumer; it is a minor release with no
API change this package uses.

`@qcms/ui` moves `@testing-library/user-event` from 14.6.3 to 14.6.5, which is a
development dependency and reaches no consumer: it is named here because the gate asks
for the package to be named, not because a published artifact changes.

Neither package's own source changes.
