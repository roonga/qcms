---
"@roonga/qcms-db": minor
---

Add the `two_factor_resets` audit table and the storage half of the `qcms:reset-2fa`
break-glass (issue #432).

Migration `0020` appends one table: who had their second factor cleared, when, by which
database role, how many factor rows went, and whether the account was enrolled. No
foreign key to `user`, on the `erasure_tombstones` precedent - an audit record that
cascades away with the thing it describes is not an audit record.

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
