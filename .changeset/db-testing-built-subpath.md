---
"@roonga/qcms-db": minor
---

Build the `@roonga/qcms-db/testing` subpath, so the published harness resolves to compiled
JavaScript and a `.d.ts` instead of to TypeScript source (issues #382 and #407).

The export condition pointed at `src/testing/harness.ts`. Vitest transformed it, which is
why every in-repo importer was happy, but plain `node` refuses to type-strip inside
`node_modules` and failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (#382); and a
TypeScript adopter who had not installed the two OPTIONAL peer dependencies could not run
`tsc` at all, getting six `TS2307`s naming packages they had been told they did not need
(#407). One export condition, two faces, so they are fixed as one change.

Building the subpath answers both, and the peers are removed from the declaration surface
rather than merely hidden: `TestDb.container` is now typed as `StartedTestPostgres`, a
structural interface this package owns (`logs()`, `getConnectionUri()`, `stop()`), instead
of `@testcontainers/postgresql`'s `StartedPostgreSqlContainer`. The emitted
`dist/testing/harness.d.ts` therefore imports neither peer, so a consumer typechecks clean
under `skipLibCheck: false` as well as the default - which matters, because a fix that
worked only for the default setting would look resolved while leaving anyone strict
exactly where they were. `harness-types.test.ts` asserts the real upstream container is
assignable to the structural type, so the two cannot drift.

Minor rather than patch: the harness gains the ability to run under any runner, which is
new capability, and `TestDb.container` narrows to a smaller type, so code that assigned it
to a `StartedPostgreSqlContainer` variable needs a cast. The runtime behaviour, the lazy
guarded load of the optional peers, and the actionable message they produce when absent
are all unchanged - that message is simply reachable now for the consumers #156 wrote it
for.
