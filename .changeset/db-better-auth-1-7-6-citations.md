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
and so is the shape better-auth expects.

How the startup schema check moved, and why it still runs the same comparison.
`@better-auth/core`'s `schema-check.mjs` splits `schemaCheckFor` into itself and a
new `runtimeSchemaCheckFor`, gives `registerSchemaCheck` a `runtimeEnabled`
option, and `create-context.mjs` now assigns `ctx.checkSchema` from the runtime
accessor. The adapter registration moved with it: `@better-auth/drizzle-adapter`
registered the check conditionally at 1.7.5, `if (checksSchema(options))
registerSchemaCheck(...)`, and at 1.7.6 registers it unconditionally with
`{ runtimeEnabled: checksSchema(options) }`. So the core option's default is not
what governs here; the adapter's explicit `checksSchema(options)` is, and that
function is unchanged: `options.advanced?.database?.validateSchema !== false`.
`apps/api` sets no `validateSchema`, so it resolves true exactly as before, and
the first request through `auth.handler` runs the same check. What is new is only
that the registered check is also reachable as `ctx.explicitSchemaCheck` when
runtime validation is off, which this repository does not use.

The adapter is therefore not unchanged, and the part of it QCMS runs is not the
`better-auth/adapters/drizzle` path it imports: that file is a two-line re-export
of `@better-auth/drizzle-adapter`, whose `dist/index.mjs`, `dist/relations-v2/index.mjs`
and schema-check chunk all move at 1.7.6, threading an optional `modelKey` through
the adapter calls beside the registration change above.

No migration is owed. `@better-auth/core`'s `get-tables.mjs` and `schema-diff.mjs`
are byte-identical between the two releases, so the expected `account` shape and
the comparison against it are the same, and the Docker-backed `api-e2e` and
`full-stack-e2e` suites exercise that path against a real Postgres. The
release-history sentences keep naming 1.7.3, which is the release that changed the
behaviour they describe.
