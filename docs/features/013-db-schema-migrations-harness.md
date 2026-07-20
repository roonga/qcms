# 013 - DB schema, migrations, test harness

**Stage:** 5 · **Package:** `@qcms/db` · **Depends on:** 008, 009 (shapes), 010 (linkId)
**References:** `ARCHITECTURE.md` §4.3 · ADR-05, ADR-07, **ADR-17, ADR-18** · Invariants I1, I4, I5

## Context

Storage for the operational skeleton. Postgres stores and indexes; it does not interpret domain JSONB. Migration history is package-owned (adopters run `drizzle-kit migrate` on upgrade), so migrations are immutable once released - the same discipline as published forms.

## Deliverables

Drizzle schema + initial migration set for:

- `questions` (questionId PK, slug unique, createdAt) · `question_versions` (questionId FK, version, definition JSONB, status: `draft|published|deprecated`, publishedAt; PK (questionId, version)). Trigger or CHECK strategy preventing UPDATE of `definition` once status='published' - document the chosen enforcement.
- `forms` (formId PK, slug, defaultLocale) · `form_drafts` (formId FK **unique** - at most one open draft, definition JSONB, updatedAt).
- `form_versions` (formId FK, version, definition JSONB, compiled JSONB, `compiler_version`, `a2ui_spec_version`, `semantics_version`, publishedAt; PK (formId, version)); no UPDATE path.
- `sessions` (sessionId PK, formId, formVersion FK pair, accessMode `anonymous|secure_link`, linkId nullable, status `created|in_progress|submitted|expired`, expiresAt, createdAt).
- `secure_links` (linkId PK, formId, expiresAt, oneTime, consumedAt nullable, revokedAt nullable, createdAt) - consumption/revocation state for 010's tokens.
- `answers` (id, sessionId FK, questionId, value JSONB, answeredAt) - **append-only: no UPDATE or DELETE in any query helper; a DB-level rule/trigger rejects UPDATE** (DELETE permitted only via the erasure path, 016).
- `submissions` (sessionId PK/FK, contentHash, lockedAnswers JSONB, submittedAt).
- `erasure_tombstones` (sessionId PK, formId, formVersion, erasedAt, reason).
- `outbox` (id, eventType, payload JSONB, createdAt, deliveredAt nullable, attempts, nextAttemptAt, deadLetteredAt nullable, lastError).
- better-auth tables per its Drizzle adapter.
- Indexes: `answers (sessionId, questionId, answeredAt DESC)`; `sessions (status, expiresAt)`; `outbox (deliveredAt, nextAttemptAt) WHERE deadLetteredAt IS NULL`.
- **Test harness**: Testcontainers-based Postgres for integration tests, wired into CI; helper `withTestDb(fn)` giving a migrated, isolated database per test file.

## Exit criteria

1. Migrate-from-zero and migrate-forward (apply N, then N+1) both tested in CI.
2. UPDATE on `answers` rejected at the database level (tested); UPDATE on published `question_versions.definition` and on `form_versions` rejected (tested).
3. One-open-draft constraint tested (second insert fails).
4. Schema documented in `packages/db/README.md` with the table table from `ARCHITECTURE.md` §4.3 kept in sync.

## Out of scope

Query helpers (014), reporting view (015), erasure implementation (016), any HTTP.
