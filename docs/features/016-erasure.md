# 016 - Erasure (ADR-17)

**Stage:** 5 · **Package:** `@qcms/db` (+ semantics in `@qcms/core`) · **Depends on:** 014, 015
**References:** **ADR-17** · `ARCHITECTURE.md` §4.3 · amended R3/I5

## Context

Right-to-erasure: hard-delete a session's respondent data, leave a tombstone proving a response existed without preserving content. Snapshots are untouched (no respondent data). The append-only rule is amended, not broken: still no UPDATE path anywhere; erasure is whole-session DELETE plus tombstone, in one transaction.

## Deliverables

- In `@qcms/core`: `EraseRequest`/`EraseOutcome` types and a documented statement of erasure semantics (what is deleted, what remains, what the tombstone asserts) - core owns *meaning*, db owns execution.
- In `@qcms/db`: `eraseSession(db, sessionId, reason): Promise<EraseOutcome>`:
  1. Single transaction: delete all `answers` rows, the `submissions` row if present, and null/scrub any session columns that could hold respondent-linkable data (document which; `linkId` is retained - it identifies the *link*, not the person, unless the adopter put PII in link distribution, which docs warn against).
  2. Insert `erasure_tombstones (sessionId, formId, formVersion, erasedAt, reason)`.
  3. Idempotent: erasing an erased session is a no-op returning the existing tombstone.
  4. Erasing a nonexistent session → typed error.
- The DB rule blocking DELETE on `answers` (013) must permit exactly this path - implement via a scoped mechanism (e.g. trigger checks a transaction-local setting the erasure function sets) and document it as the *only* delete door.
- Reporting exclusion verified end-to-end (015's view).
- `docs/erasure.md`: operator guidance - what erasure does and does not cover (webhook consumers are independent controllers; Postgres backups age out per the adopter's backup retention; WAL/replicas noted honestly).

## Exit criteria

1. Transactionality: induced failure after answer-delete rolls back everything (no tombstone, answers intact).
2. Post-erasure: `latestAnswers` empty; `answerLedger` empty; submission gone; tombstone present; session absent from `reporting.responses` and `answers_flat`.
3. Idempotency and nonexistent-session tests.
4. Ad-hoc DELETE on answers outside the erasure path still rejected (the door is scoped).

## Out of scope

The admin API slice (023) and UI (035); backup-media erasure (documented, not solved); crypto-shredding (rejected for launch by ADR-17).
