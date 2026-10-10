---
"@roonga/qcms-db": patch
"create-qcms-app": patch
---

Dependency maintenance. No source in these packages changed and their public APIs
are identical; only the ranges below moved.

**@roonga/qcms-db**

No range in this package moved and no behaviour did either. What changed is the
version its auth schema mirror cites: `src/schema/control/auth.ts` justifies each
mirrored column against better-auth's own generated schema at a `file:line`, and
a claim about a library's internals names the version it was read against, so the
version beside the package name moves to 1.7.7 with the pin. The cited lines were
re-read rather than renumbered. `@better-auth/core/dist/db/schema-check.mjs` and
both `@better-auth/drizzle-adapter` schema chunks are byte-identical between
1.7.6 and 1.7.7, 1.7.7 adds, removes and renames no column, and upstream states
that no database migration is required, so the mirror this package generates is
unchanged and so is every migration under `migrations/`.

**create-qcms-app**

Ranges in the app manifests this CLI stamps, regenerated from the canonical
apps by `pnpm qcms:sync-templates`. The CLI's own behaviour is unchanged; a
newly scaffolded project installs the versions this repository resolves:

- `better-auth` 1.7.6 to 1.7.7 (dependencies in apps/api)

Two cited lines move with it, and nothing they describe changed.
`dist/api/rate-limiter/index.mjs` now sets `Content-Type: application/json` on the
429 it returns, which is three lines longer, so the `rateLimit.enabled` gate the
scaffolded `instance.ts` cites moves from `:290` to `:293` and the default
sign-in rule moves from `:302-308` to `:305-311`. The resolution order and the
three-attempts-per-ten-seconds numbers recorded beside them are unchanged.

Of the files this repository cites, those are the only lines that moved: the one
other changed file it reads, `@better-auth/core/dist/types/init-options.d.mts`,
takes a one-line in-place edit far below both of its citations, and every other
cited file is byte-identical between the two versions.
