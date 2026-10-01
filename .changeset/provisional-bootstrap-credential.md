---
"@roonga/qcms-db": minor
---

The bootstrap credential is provisional (task 061, SEC-1).

`user.mustChangePassword` joins the auth schema, with migration `0023` adding the column
to the existing table. The column default is `false`, so **an account that predates this
control is not marked on upgrade**: for such a row nobody can tell whether the password
was ever changed, and backfilling `true` would make a migration force a password change on
every live deployment's administrator. Accounts created from this version onwards are
marked by better-auth itself, which applies the `defaultValue: true` the API declares in
`user.additionalFields`.

`getAdminSessionByToken` now returns `mustChangePassword` on `AdminSessionRow`, so the
API's admin-auth middleware can refuse an admin route while the flag is set, and the new
`clearMustChangePassword` write clears it. That write has exactly one caller: the
`account.update.after` database hook the API installs on better-auth, which fires when the
library writes a new password hash to a credential account - the only event that means a
password was successfully changed.

No existing export changed behaviour; `AdminSessionRow` gains a field.
