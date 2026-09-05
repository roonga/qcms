---
"@roonga/qcms-db": minor
---

Reconcile the auth schema mirror with better-auth 1.7, which keys an account on
`(issuer, accountId)` rather than on `accountId` alone.

The library validates the Drizzle schema at startup and refuses to run on a mismatch, so
this is not optional: on 1.7 without it, every auth request fails with `The field "issuer"
does not exist in the "account" Drizzle schema`, and sign-in returns 401 for accounts that
were just created. `account` gains a required `issuer` column and the unique index on
`(issuer, accountId)` that better-auth declares for itself.

Migration `0017_account_issuer` deliberately does **not** do the nullable-backfill-constrain
sequence the 1.7 upgrade guide prescribes for a live database: QCMS is pre-launch and no
deployment's account rows need to survive (Code Owner, 2026-08-25). It adds the column with
a default and drops the default in the next statement, which is only so the statement
succeeds against a developer's own stack rather than requiring a teardown. `local:credential`
is the one issuer QCMS can have.
