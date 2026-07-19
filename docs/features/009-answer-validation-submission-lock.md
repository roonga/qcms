# 009 — Answer validation and submission lock

**Stage:** 3 · **Package:** `@qcms/core` · **Depends on:** 006, 008
**References:** `DOMAIN_SCHEMA.md` §4.3 · ADR-07 · Invariants I5, I6, I9

## Context

Two remaining kernel obligations: what a valid answer is (per question type and constraints), and what submission locks (the visible-required sweep and hidden-answer exclusion — the audit boundary).

## Deliverables

- `validateAnswer(question: QuestionDefinition, value: unknown): Result<AnswerValue, ValidationError[]>`:
  - Parses `value` against the canonical encoding for the question's type (002), then checks every constraint (003): length bounds, pattern, numeric bounds + `integer`, date bounds, option membership, selection counts.
  - Returns all failed constraints, not the first; errors carry `{ code, constraint, message }` suitable for direct UI display (portal will localize via shell catalog later — codes are the contract).
  - `required` is *not* checked here — presence is a submission/flow concern, not a value concern.
- `prepareSubmission(snapshot, answers: AnswerMap): Result<LockedSubmission, SubmissionError[]>`:
  1. Evaluate flow state (006).
  2. Every **visible required** question must have a valid answer (`MISSING_REQUIRED` with questionId); every present answer for a visible question re-validated (`INVALID_ANSWER`).
  3. Answers for **hidden** questions are excluded from the locked set (I6) — they remain in the ledger (audit), never in the submission.
  4. Output `LockedSubmission`: `{ answers: canonical ordered array, flowState, contentHash }` — `contentHash` = SHA-256 over a canonical JSON serialization (stable key order; document the canonicalization). Hashing must work fetch-pure (WebCrypto `crypto.subtle`, async is fine).
- Answers for questions not in the form at all → `UNKNOWN_QUESTION` error (defense against ledger drift).

## Exit criteria

1. Per-type constraint matrix tests: each constraint violated alone yields exactly its error; compound violations yield all.
2. Submission tests: hidden required question does **not** block submit; hidden answered question excluded from `LockedSubmission` but assertable in input; visible required missing blocks with correct id list.
3. `contentHash` stable across key order and Node versions (golden hash for the insurance fixture submission).
4. Kernel coverage across 002–009 effectively total (`pnpm --filter @qcms/core coverage` ≥ 95% lines; justify any exclusion in code).

## Out of scope

Ledger storage (013), the HTTP submit slice (020), localization of messages.
