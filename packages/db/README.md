# @qcms/db

The operational storage layer for qcms: the Drizzle schema, the package-owned
migration history, and the Testcontainers test harness. Postgres **stores and
indexes** the domain JSONB but never interprets it - every domain invariant is
owned by `@qcms/core`; the database enforces only the structural backstops
(immutability, append-only, one-open-draft) that must hold regardless of which
process writes.

Migration history is package-owned and **append-only**: adopters run
`drizzle-kit migrate` on upgrade, so a released migration file is immutable - the
same discipline as a published form (ADR-18). Never edit a migration that has
shipped; add a new one.

## Table inventory (kept in sync with `ARCHITECTURE.md` §4.3)

| Table                             | Purpose                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `questions`, `question_versions`  | Question library; a version's `definition` is frozen once `status = 'published'` (I1)                                             |
| `forms`, `form_drafts`            | Form identity + lifecycle `status` (`open`/`closed`, §4.1) and mutable working state; **at most one open draft per form** (the draft's `form_id` primary key) |
| `form_versions`                   | Immutable published snapshots: domain JSONB + compiled A2UI JSONB + `compiler_version` + `a2ui_spec_version` + `semantics_version` |
| `sessions`                        | Respondent sessions; pinned `(form_id, form_version)`, access mode, expiry (I4)                                                   |
| `secure_links`                    | Server-side state for secure-link tokens (SEC-2, task 010): revocation and one-time consumption - a signature alone is never enough |
| `answers`                         | **Append-only** ledger `(session_id, question_id, value, retracted, answered_at)`; current = latest row, unless it is a retraction (ADR-33), which resolves to unanswered; UPDATE rejected at the DB level (I5) |
| `submissions`                     | Lock records: session, locked answer set + content hash, submitted timestamp                                                     |
| `erasure_tombstones`              | ADR-17: `(session_id, form_id, form_version, erased_at, reason)` - existence without content                                     |
| `outbox`                          | Transactionally written domain events with delivery state, attempt count, next-retry, dead-letter flag                           |
| `user`, `session`, `account`, `verification`, `twoFactor` | better-auth tables - admin identity with TOTP 2FA at launch                                              |

> The better-auth `session` table (singular) is distinct from the domain
> `sessions` table (plural).

## Enforcement decisions

Three rules are cross-version predicates - "this value may not change" - which a
`CHECK` constraint cannot express (a CHECK only validates a NEW row against a
static predicate; it has no access to the OLD row). Each is therefore a
`BEFORE UPDATE` trigger, installed by migration `0001`:

- **`answers_reject_update`** - `answers` is append-only (I5, R3). Every UPDATE
  is rejected. `DELETE` is deliberately **not** guarded here: the sole DELETE
  door is whole-session erasure (ADR-17, task 016).
- **`question_versions_freeze_published`** - once a version is `published`, its
  `definition` is frozen (I1). Status transitions (e.g. `published → deprecated`)
  and setting `published_at` are still allowed; only a change to `definition` on
  a published row is rejected. Draft rows remain freely editable.
- **`form_versions_reject_update`** - published snapshots are immutable (R1, I1);
  every UPDATE is rejected. There is no update path.

The **one-open-draft** invariant needs no trigger: `form_drafts.form_id` is the
primary key, so a second draft insert for the same form fails on the unique
constraint.

The **answer-or-retraction** invariant needs no trigger either: the CHECK
`answers_retraction_value` (migration `0009`, ADR-33) permits only the two legal
row shapes - an answer (`retracted = false`, `value` present) or a retraction
(`retracted = true`, `value` null) - so an audit reader can branch on `retracted`
without trusting the writer, and no sentinel ever lives inside `value`.

## Indexes

- `answers (session_id, question_id, answered_at DESC)` - latest-per-question resolution.
- `sessions (status, expires_at)` - the retention sweep's scan.
- `outbox (delivered_at, next_attempt_at) WHERE dead_lettered_at IS NULL` -
  partial index for the deliverer's claim query.

## Migrations

- **Authoring:** `pnpm --filter @qcms/db db:generate` (`drizzle-kit generate`)
  diffs the schema in `src/schema/` against the last snapshot and writes the next
  SQL file offline. The trigger migration (`0001`) is hand-authored custom SQL -
  triggers are not expressible as Drizzle schema.
- **Applying (adopters):** `drizzle-kit migrate` against `migrations/`.
- Files, snapshots (`migrations/meta/`), and the journal are committed and
  **append-only**.

## Test harness

`src/testing/harness.ts` boots a real Postgres in a throwaway container
(Testcontainers) and migrates it to head - the same path adopters run. It is a
test-only utility, excluded from the build and published at the `@qcms/db/testing`
subpath. Adopters import it by that subpath, which is what the example below
shows. This package's own tests live inside the package, so they reach the same
module by relative path instead (`../testing/harness.js`) and never exercise the
subpath: that is why the subpath has tests of its own (`harness-deps.test.ts`).

```ts
import { withTestDb, startTestDb } from "@qcms/db/testing";

// one-shot
await withTestDb(async ({ db, client }) => {
  /* migrated, isolated database */
});

// one container per test file (share across tests in the file)
let ctx;
beforeAll(async () => (ctx = await startTestDb()));
// Optional chaining on purpose: if the boot failed, `ctx` was never assigned and
// an unguarded teardown buries the real error under a TypeError (issue #74).
afterAll(() => ctx?.teardown());
```

`db` is a Drizzle handle over a **connection pool**, as the API builds it in
production, so concurrent `db.transaction()` calls get their own connections and
per-session `pg_advisory_xact_lock` serialization behaves under test as it does in
production (issue #30). `client` is a separate single connection for raw SQL: it
sees only committed state, so do not use it to observe a transaction another
connection still has open.

`applyMigrations(client, { from, to })` applies migration files one at a time
(bypassing Drizzle's tracker) so a test can observe the schema **between**
migrations - the "apply N, then N+1" forward path.

**Requirements.** These are integration tests: they need a running Docker daemon,
plus `@testcontainers/postgresql` and `testcontainers` (the harness imports
Testcontainers' reaper bootstrap directly, so `testcontainers` is declared rather
than borrowed transitively). Both are **optional peer dependencies** of `@qcms/db`
and are not installed for you:

```sh
pnpm add -D @testcontainers/postgresql testcontainers
```

Optional, because they are test-only: a consumer of the runtime surface should not
acquire a Docker client it never uses (issue #156). They stay devDependencies of
this package as well, so the workspace's own suites have them. Importing
`@qcms/db/testing` without them resolves fine; the first `startTestDb()` then
fails with a message naming both packages and the command above, rather than
Node's bare `Cannot find package`. The harness is consumed under Vitest, which
transforms its TypeScript source; a plain `node` import of the subpath is not
supported.

On Linux CI (`ubuntu-latest`) this works out of the box. The harness
sets an empty `DOCKER_AUTH_CONFIG` before Testcontainers loads so image pulls are
anonymous and the Docker Desktop credential helper (`docker-credential-desktop`,
unresolvable from some Windows shells) is never invoked; set `DOCKER_AUTH_CONFIG`
or `DOCKER_CONFIG` yourself to override.

**Which image, and where it comes from.** The harness boots `postgres:16-alpine`
from Docker Hub, so a laptop needs no registry account or mirror. Set
`QCMS_TEST_POSTGRES_IMAGE` (read once, at module load, so export it before the
test process starts) to boot the same Postgres from somewhere else. CI does
exactly that: anonymous Docker Hub pulls from shared runner IP ranges are
rate-limited and intermittently return HTTP 500, which failed every `@qcms/db`
test file twice in one day, so each CI job resolves a GHCR mirror of the image
first (`.github/actions/test-postgres-image`, populated by the
`Mirror test images` workflow) and falls back to Docker Hub when no mirror is
available. Keep the value on the same Postgres major: the migrations target 16.

In this repo the variable must also be listed in `turbo.json`'s
`globalPassThroughEnv`, because turbo 2.x runs tasks in strict env mode and
`pnpm test` is `turbo run test`: exporting it in the shell is not enough on its own
to reach the Vitest process.

When the image cannot be pulled, `startTestDb` throws an error naming the image,
the registry failure and the override, instead of Docker's opaque
`(HTTP code 500) ...` (issue #74), and every later boot of that same image in the
worker fails immediately rather than waiting on the registry again.

**The Ryuk reaper is a separate image, and a separate failure.** Testcontainers
boots a cleanup sidecar (`testcontainers/ryuk`) before the first container;
`QCMS_TEST_POSTGRES_IMAGE` does not redirect it, so it kept pulling from Docker
Hub after the mirror landed and a Hub timeout on it failed a CI leg while the
mirror was fine. `startTestDb` therefore brings the reaper up as its own step,
before asking for Postgres, and reports a failure there as a *reaper* failure
naming `TESTCONTAINERS_RYUK_DISABLED` and `RYUK_CONTAINER_IMAGE` - never as a
Postgres-image pull failure sending you to check a working mirror (issue #150).
CI sets `TESTCONTAINERS_RYUK_DISABLED=true` because a runner is destroyed with the
job; local runs keep the reaper, because your machine is not.

## better-auth tables

`src/schema/auth.ts` mirrors the default Drizzle schema that better-auth's
adapter expects for its core models plus the `twoFactor` plugin (camelCase
columns, `text` primary keys), so admin users/sessions/accounts share the
deployment's one Postgres. They are isolated from the domain schema (no foreign
keys cross between auth and questionnaire tables). When the auth instance's plugin
set changes, regenerate this file with `@better-auth/cli generate` against it and
diff.

The instance itself lives in `apps/api/src/features/auth/instance.ts` (task 056;
ADR-35 as amended 2026-07-31). It was in the admin app for tasks 031-035, and the
consumer matters here for one practical reason: **`qcms-api` is now the only
workspace that imports these tables as values.** The admin's import-surface test
asserts an empty allowlist of `@qcms/db` value bindings, so an addition to the auth
exports has exactly one caller to satisfy.

**Dependency note.** `better-auth` and `drizzle-orm` are both on the
accepted-with-noted-risk list in `CONTRIBUTING.md` (young, VC-funded; narrow
scope, all data in our own Postgres, bounded exit paths). This task adds no
`better-auth` runtime dependency - the tables are hand-authored Drizzle
definitions matching its adapter, and the auth runtime lands with the shell
config in task 031.
