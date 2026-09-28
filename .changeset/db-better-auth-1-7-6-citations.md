---
"@roonga/qcms-db": patch
---

Carry the auth schema mirror's better-auth citation to 1.7.6.

`packages/db/src/schema/auth.ts` documents why this mirror is a mirror and which
better-auth release made the startup schema check run in both directions, and it
names the version it was read against. PR #1007 moves the exact pin in `apps/api`
from better-auth 1.7.5 to 1.7.6, so the version beside the package name moves with
it.

Comments only. The schema, the migrations and the exported types are unchanged,
and so is the shape better-auth expects. `@better-auth/core`'s `get-tables.mjs`
and `schema-diff.mjs` are byte-identical between the two releases, and
`schema-check.mjs` changes without changing what runs here: `registerSchemaCheck`
gains a `runtimeEnabled` option that defaults to true, `schemaCheckFor` is split
into it and a new `runtimeSchemaCheckFor`, and `create-context.mjs` now assigns
`ctx.checkSchema` from the latter. Nothing in the tree passes the new option and
the Drizzle adapter is byte-identical, so the first request through `auth.handler`
runs the same comparison against the same expected `account` shape and no
migration is owed. The release-history sentences keep naming 1.7.3, which is the
release that changed the behaviour they describe.
