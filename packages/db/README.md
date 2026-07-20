# @qcms/db

The operational storage layer for qcms: the Drizzle schema, the package-owned
migration history, and the Testcontainers test harness. Postgres **stores and
indexes** the domain JSONB but never interprets it — every domain invariant is
owned by `@qcms/core`; the database enforces only the structural backstops
(immutability, append-only, one-open-draft) that must hold regardless of which
process writes.

Migration history is package-owned and **append-only**: adopters run
`drizzle-kit migrate` on upgrade, so a released migration file is immutable — the
same discipline as a published form (ADR-18). Never edit a migration that has
shipped; add a new one.

## Table inventory (kept in sync with `ARCHITECTURE.md` §4.3)

| Table                             | Purpose                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `questions`, `question_versions`  | Question library; a version's `definition` is frozen once `status = 'published'` (I1)                                             |
| `forms`, `form_drafts`            | Form identity and mutable working state; **at most one open draft per form** (the draft's `form_id` primary key)                  |
| `form_versions`                   | Immutable published snapshots: domain JSONB + compiled A2UI JSONB + `compiler_version` + `a2ui_spec_version` + `semantics_version` |
| `sessions`                        | Respondent sessions; pinned `(form_id, form_version)`, access mode, expiry (I4)                                                   |
| `secure_links`                    | Server-side state for secure-link tokens (SEC-2, task 010): revocation and one-time consumption — a signature alone is never enough |
| `answers`                         | **Append-only** ledger `(session_id, question_id, value, answered_at)`; current = latest row; UPDATE rejected at the DB level (I5) |
| `submissions`                     | Lock records: session, locked answer set + content hash, submitted timestamp                                                     |
| `erasure_tombstones`              | ADR-17: `(session_id, form_id, form_version, erased_at, reason)` — existence without content                                     |
| `outbox`                          | Transactionally written domain events with delivery state, attempt count, next-retry, dead-letter flag                           |
| `user`, `session`, `account`, `verification`, `twoFactor` | better-auth tables — admin identity with TOTP 2FA at launch                                              |

> The better-auth `session` table (singular) is distinct from the domain
> `sessions` table (plural).

## Enforcement decisions

Three rules are cross-version predicates — "this value may not change" — which a
`CHECK` constraint cannot express (a CHECK only validates a NEW row against a
static predicate; it has no access to the OLD row). Each is therefore a
`BEFORE UPDATE` trigger, installed by migration `0001`:

- **`answers_reject_update`** — `answers` is append-only (I5, R3). Every UPDATE
  is rejected. `DELETE` is deliberately **not** guarded here: the sole DELETE
  door is whole-session erasure (ADR-17, task 016).
- **`question_versions_freeze_published`** — once a version is `published`, its
  `definition` is frozen (I1). Status transitions (e.g. `published → deprecated`)
  and setting `published_at` are still allowed; only a change to `definition` on
  a published row is rejected. Draft rows remain freely editable.
- **`form_versions_reject_update`** — published snapshots are immutable (R1, I1);
  every UPDATE is rejected. There is no update path.

The **one-open-draft** invariant needs no trigger: `form_drafts.form_id` is the
primary key, so a second draft insert for the same form fails on the unique
constraint.

## Indexes

- `answers (session_id, question_id, answered_at DESC)` — latest-per-question resolution.
- `sessions (status, expires_at)` — the retention sweep's scan.
- `outbox (delivered_at, next_attempt_at) WHERE dead_lettered_at IS NULL` —
  partial index for the deliverer's claim query.

## Migrations

- **Authoring:** `pnpm --filter @qcms/db db:generate` (`drizzle-kit generate`)
  diffs the schema in `src/schema/` against the last snapshot and writes the next
  SQL file offline. The trigger migration (`0001`) is hand-authored custom SQL —
  triggers are not expressible as Drizzle schema.
- **Applying (adopters):** `drizzle-kit migrate` against `migrations/`.
- Files, snapshots (`migrations/meta/`), and the journal are committed and
  **append-only**.

## Test harness

`src/testing/harness.ts` boots a real Postgres in a throwaway container
(Testcontainers) and migrates it to head — the same path adopters run. It is a
test-only utility (excluded from the build, depends on devDependencies), used by
this package's own tests via a relative import:

```ts
import { withTestDb, startTestDb } from "./testing/harness.js";

// one-shot
await withTestDb(async ({ db, client }) => {
  /* migrated, isolated database */
});

// one container per test file (share across tests in the file)
let ctx;
beforeAll(async () => (ctx = await startTestDb()));
afterAll(() => ctx.teardown());
```

`applyMigrations(client, { from, to })` applies migration files one at a time
(bypassing Drizzle's tracker) so a test can observe the schema **between**
migrations — the "apply N, then N+1" forward path.

**Requirements.** These are integration tests: they need a running Docker
daemon. On Linux CI (`ubuntu-latest`) this works out of the box. The harness
sets an empty `DOCKER_AUTH_CONFIG` before Testcontainers loads so image pulls are
anonymous and the Docker Desktop credential helper (`docker-credential-desktop`,
unresolvable from some Windows shells) is never invoked; set `DOCKER_AUTH_CONFIG`
or `DOCKER_CONFIG` yourself to override.

## better-auth tables

`src/schema/auth.ts` mirrors the default Drizzle schema that better-auth's
adapter expects for its core models plus the `twoFactor` plugin (camelCase
columns, `text` primary keys), so admin users/sessions/accounts share the
deployment's one Postgres. They are isolated from the domain schema (no foreign
keys cross between auth and questionnaire tables). When the auth instance is
wired in owned shell code (task 031), regenerate this file with
`@better-auth/cli generate` against the configured plugin set and diff.

**Dependency note.** `better-auth` and `drizzle-orm` are both on the
accepted-with-noted-risk list in `CONTRIBUTING.md` (young, VC-funded; narrow
scope, all data in our own Postgres, bounded exit paths). This task adds no
`better-auth` runtime dependency — the tables are hand-authored Drizzle
definitions matching its adapter, and the auth runtime lands with the shell
config in task 031.
