---
"@qcms/core": minor
"@qcms/db": minor
---

Add right-to-erasure: hard-delete a session's content with a tombstone (task 016, ADR-17, I11).

`@qcms/core` (`src/erasure.ts`) owns the *meaning*: `EraseRequest`, `EraseOutcome`, and
`EraseErrorCode`, plus a documented statement of what erasure deletes, what it retains, and
what the tombstone asserts. Pure — no I/O (R3).

`@qcms/db` (`queries/erasure.ts`) owns the *execution*:

- `eraseSession(exec, sessionId, reason): Promise<EraseOutcome>` runs one transaction that
  deletes every `answers` row and the `submissions` lock, scrubs respondent-linkable session
  columns (none in the launch schema; `linkId` is retained by design), and writes an
  `erasure_tombstones` row. It is idempotent (re-erasing returns the existing tombstone
  unchanged) and throws a typed `SessionNotFoundError` for a session that never existed. All
  steps share one transaction, so a failure after the answer delete rolls everything back.
- Migration `0004` adds a scoped DELETE door: a `BEFORE DELETE` trigger
  (`answers_reject_delete`) rejects any `answers` DELETE unless the transaction-local guard
  `qcms.allow_answer_delete` is `'on'`. The two sanctioned whole-session delete paths —
  `eraseSession` (016) and `purgeExpired` (015) — open it via `openAnswerDeleteDoor`; every
  other ad-hoc DELETE is now rejected (closes the gap issue #4 flagged).

Erased sessions are excluded from `reporting.responses` / `reporting.answers_flat` two ways
independently — the submission hard-delete and the tombstone anti-join. Operator guidance,
including the honest boundaries (webhook consumers are independent controllers; backups/WAL/
replicas age out per the adopter's retention), is in `docs/erasure.md`.
