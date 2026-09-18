---
"@roonga/qcms-db": patch
---

Carry the auth schema mirror's better-auth citations to 1.7.5.

`packages/db/src/schema/auth.ts` documents why this mirror is a mirror and which
better-auth release made the startup schema check run in both directions, and it
names the version it was read against. PR #930 moves the exact pin in `apps/api`
from better-auth 1.7.3 to 1.7.5, so the version beside the package name moves with
it.

Comments only. The schema, the migrations and the exported types are unchanged,
and so is the shape better-auth expects: `@better-auth/core`'s `get-tables.mjs`,
`schema-check.mjs` and `schema-diff.mjs` are byte-identical between the two
releases, so nothing about the `account` table or the comparison against it moved
and no migration is owed. The release-history sentences keep naming 1.7.3, which
is the release that changed the behaviour they describe.
