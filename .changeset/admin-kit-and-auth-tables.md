---
"@roonga/qcms-ui": minor
"@roonga/qcms-db": minor
---

Admin shell support (task 031).

`@roonga/qcms-ui` gains a `./kit` subpath: the admin UI kit primitives (alert, breadcrumb,
button, card, dialog, form, table, text, text-field) as plain React components, vendored
from the pinned a2-react-aria registry via the a2ra CLI (ADR-22). The admin's own screens
are ordinary React on these, so both frontends share one component stack and one token
contract. `alert`, `breadcrumb`, `button`, `card`, `dialog` and `table` are new vendored
components; `src/components/action-context` is QCMS-owned glue that re-exports
`ActionContext` from `@a2ra/core`, because the upstream `button` registry entry ships a
relative import it does not declare as a file or a registry dependency.

`@roonga/qcms-db` gains the two admin identity reads the API and the bootstrap CLI need
(`getAdminSessionByToken`, `countAdminUsers`) and two additive migrations: `user.role`
(the SEC-3 role claim, single `admin` value at launch, carried so Phase 4 RBAC is code
rather than a migration) and the three `twoFactor` columns better-auth's plugin requires
(`verified`, `failedVerificationCount`, `lockedUntil`) which the hand-written 013 mirror
was missing.

No existing export changed behaviour.
