# 015 — Reporting view and retention sweep

**Stage:** 5 · **Package:** `@qcms/db` · **Depends on:** 014
**References:** `ARCHITECTURE.md` §4.3, §5.3 · ADR-10, **ADR-17**

## Context

The reporting view is the documented pull-integration path shipping at launch instead of `/api/v1` — a **SQL contract** for BI/ETL consumers, so its shape is versioned documentation, not an implementation detail. The retention sweep is where the GDPR story starts: abandoned data expires by default.

## Deliverables

- Migration creating schema `reporting` with:
  - `reporting.responses` — one row per **submitted** session: sessionId, formId, formVersion, submittedAt, accessMode, and the locked answers as JSONB keyed by questionId. Excludes erased sessions **by construction** (join against tombstones or build from `submissions` which erasure deletes — document which).
  - `reporting.answers_flat` — one row per (submitted session, questionId, canonical value) for tools that want long format.
- `docs/reporting-view.md` — the contract: column semantics, canonical value encodings (reference 002), stability promise (additive changes only; renames/removals require a major `@qcms/db` version), connection guidance (read-only role recommended; sample `CREATE ROLE` grant).
- **Retention sweep**: `sweepExpiredSessions(db, now)` — transitions `created`/`in_progress` sessions past `expiresAt` to `expired`. Data deletion for expired sessions is a *documented policy decision*: default keeps the ledger (audit) and only expires the session; a `purgeExpired(olderThan)` helper exists for adopters who want hard cleanup. Scheduling happens in the API (017).
- Default session TTLs as configuration with documented defaults (e.g. anonymous 24h, secure-link = link expiry; final numbers documented).

## Exit criteria

1. View integration tests: submitted sessions appear; in-progress/expired do not; erased sessions (016 lands next — write the test now against the tombstone join, or coordinate) do not; JSONB answers match locked submissions exactly.
2. Sweep tests: boundary conditions at `expiresAt`; submitted sessions never expired; idempotent re-run.
3. `purgeExpired` removes ledger rows for expired-never-submitted sessions only.
4. Contract doc reviewed against the actual view definition (no drift — assert column list in a test).

## Out of scope

Erasure itself (016), CSV/JSON export endpoints (023), any BI tooling.
