---
"@roonga/qcms-db": minor
---

Add the `two_factor_resets` audit table and the storage half of the `qcms:reset-2fa`
break-glass (issue #432).

Migration `0021` appends one table: who had their second factor cleared, when, by which
database role, how many factor rows went, and whether the account was enrolled. No
foreign key to `user`, on the `erasure_tombstones` precedent - an audit record that
cascades away with the thing it describes is not an audit record.

**The migration also revokes, and that is the part an upgrade changes for you.** The
audit table is migrate-only, so `0021` takes `SELECT`, `INSERT`, `UPDATE` and `DELETE`
on it back from `qcms_app` after creating it - an audit row the credential serving
traffic can rewrite or delete records nothing against the attacker the SEC-10 role split
is drawn against. It has to be a revoke because neither `GRANT ... ON ALL TABLES` nor
`ALTER DEFAULT PRIVILEGES` can name an exception, so the blanket grant lands and is
taken back. Nothing on the request path reads or writes this table, so no application
code is affected; only the privilege changes.

Two consequences worth knowing before you upgrade. The revoke is guarded on the role
existing, so a database migrated as a single superuser (a Testcontainers harness, a
development database) is unaffected. And it names `qcms_app` as a literal, because a
migration cannot know a name you chose: **if you renamed your application role, this
revoke does not reach it** and you carry the line into your own role recipe.
`docs/operations.md` has the SQL and the reasoning.

Four helpers come with it. `findAdminsByEmail` resolves an account case-insensitively,
which is what makes a two-account address an ambiguity a caller can refuse rather than
guess at. `clearAdminTwoFactor` deletes the `twoFactor` row and clears
`user.twoFactorEnabled` together, because either alone leaves an account nobody can use.
`recordTwoFactorReset` appends the audit row. `readConnectedRole` reports `current_user`
and whether it owns the schema, which is the SEC-10 guard in front of all of it.

`clearAdminTwoFactor` is the one write to the auth tables in this package, and the file
header that used to say better-auth owns every one of them now records the exception
rather than being quietly untrue: the stored TOTP secret and the recovery codes are
ciphertext under a key whose loss is the whole reason the command exists, so the library
can neither verify the factor nor disable it, and deleting the row is the only operation
left that means anything.
