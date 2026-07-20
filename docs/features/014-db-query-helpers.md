# 014 - Query helpers

**Stage:** 5 · **Package:** `@qcms/db` · **Depends on:** 013
**References:** `ARCHITECTURE.md` §4.3, §5.3 · R3, R5

## Context

The helpers API slices call. Slices load state, pass it to the kernel, persist results (R3); these helpers are that loading/persisting vocabulary. No business logic here - shape-preserving reads and writes only.

## Deliverables

Typed helpers (each taking a Drizzle client/transaction as first argument so slices control transaction boundaries):

- **Questions:** `createQuestion`, `createQuestionVersion` (next version number, transactional), `publishQuestionVersion`, `deprecateQuestionVersion`, `getQuestionVersion`, `listQuestions` (with latest-version summary), `isQuestionIdTaken` (R6 support: also checks tombstoned/historic use).
- **Forms:** `createForm`, `upsertDraft`, `getDraft`, `deleteDraft`, `insertFormVersion` (next version, transactional, with all version stamps), `getFormVersion`, `getLatestPublishedVersion`, `listFormVersions`, `closeForm`/`reopenForm` status transitions.
- **Sessions:** `createSession` (pins formVersion - no helper exists to change it, making I4 structural), `getSession`, `markInProgress`, `markSubmitted`, `expireSessions(now)` (used by 015's sweep).
- **Secure links:** `insertSecureLink`, `getSecureLink`, `consumeSecureLink` (atomic compare-and-set on `consumedAt` for one-time links), `revokeSecureLink`.
- **Answers:** `appendAnswer` (insert only), `latestAnswers(sessionId): AnswerMap` (`DISTINCT ON (question_id) ... ORDER BY answered_at DESC` or window function - the latest-per-question contract), `answerLedger(sessionId)` (full history, for audit/export).
- **Submissions:** `insertSubmission`.
- **Outbox:** `enqueue(tx, event)` (must be called inside the caller's transaction - the transactional-outbox contract), `claimDue(limit)` using `FOR UPDATE SKIP LOCKED`, `markDelivered`, `recordFailure` (increments attempts, computes nextAttemptAt via exponential backoff, sets deadLetteredAt past max attempts), `listDeadLetters`, `resetForRedelivery`.

## Exit criteria

1. Integration tests (013 harness) for every helper, including: `latestAnswers` with multiple revisions; concurrent `appendAnswer` on one session; `consumeSecureLink` race (two concurrent consumers, exactly one wins); `claimDue` under two concurrent claimers (no double-claim).
2. `createSession`'s pin immutability: no exported helper mutates `formVersion` (import-surface test).
3. Backoff schedule for `recordFailure` documented and unit-tested (e.g. 1m, 5m, 25m, … cap 6h, dead-letter after 10 attempts - final numbers documented in code).

## Out of scope

Reporting view (015), erasure (016), any evaluation or validation logic.
