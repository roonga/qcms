---
"@roonga/qcms-db": minor
---

Drop `account.issuer` and its unique index, reconciling the auth schema mirror with
better-auth 1.7.3.

better-auth 1.7.0 through 1.7.2 keyed an account on `(issuer, accountId)` and required
the column; 1.7.3 recognizes an account by `(providerId, accountId)` again, as 1.6 did,
and never writes `issuer`. That reversal is not cosmetic here: 1.7.3 also checks the
generated Drizzle schema in the other direction, so a `NOT NULL` column with no default
that the library never writes now throws `SchemaMismatchError` on the first request and
every sign-up fails (issue #849).

The official 1.7 upgrade guide's Prisma-and-Drizzle instruction is to regenerate rather
than hand-write the relaxation, because the regenerated `account` model drops both the
field and the compound unique index. Migration `0020_account_drops_issuer` is that
output, dropping the index before the column as the guide directs. Adopters running a
database created by `0017_account_issuer` need nothing beyond applying it; there is no
backfill, because `local:credential` was the one issuer QCMS could produce.
