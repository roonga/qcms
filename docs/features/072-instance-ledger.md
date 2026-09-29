# 072 - The instance ledger

**Stage:** 8c (launch scope) · **Apps/packages:** `@roonga/qcms-db` (migration, queries, schema mirror), `apps/api` (the roster derivation) · **Depends on:** 071 (the branded ids and the roster's shape)
**References:** ADR-42 (the roster is a table and not an answer) · ADR-40 as amended 2026-09-30 (the eighth data-plane table, seventeen guards, eight foreign keys, and the baseline note) · ADR-17 (erasure and retention) · ADR-33 as amended 2026-09-30 (a retraction is per instance) · SEC-16 · SEC-10 · `plan/repeating-groups-and-table-input.md` sections 5.1, 5.2 and 5.7, and Q5, Q16 · R3 · issue #5 · issue #861

## Context

An instance's answers live in the existing append-only ledger keyed one column wider, and the **roster** (which instances exist, in what order, and which were removed) is state the ledger cannot express. ADR-42 puts it in its own append-only table rather than in a synthetic answer: `answers.question_id` would otherwise hold something that is not a `questionId`, colliding with `prepareSubmission`'s `UNKNOWN_QUESTION` drift defence, with R6 and with the reporting view's contract that a row is a question.

The roster is also what makes "Add passenger" a thing a respondent can watch happen. Derived from the answers, an instance nobody has answered yet would not exist, so an add would do nothing visible and a reload would lose the empty card.

## Deliverables

- **`answers.instance_id text NULL`**, the current-value rule becoming latest per `(question_id, instance_id)`: one more key in `latestAnswers`'s `DISTINCT ON`, and `instance_id` added to `answers_session_question_answered_at_idx` before `answered_at`. `answers_reject_update`, `answers_reject_delete` and `answers_retraction_value` are unchanged and cover the new column by construction. **The value is never touched**: no sentinel inside `value`, no index encoded into `question_id`, on migration 0009's own stated precedent.
- **`answer_group_instances`**, appended: `id uuid PK`, `session_id text NOT NULL` referencing `sessions.session_id`, `group_id text NOT NULL` with no foreign key, `instance_id text NOT NULL`, `event text NOT NULL` in `('added','removed')`, `occurred_at timestamptz NOT NULL DEFAULT now()`. Two triggers mirroring the ledger's (`..._reject_update`, `..._reject_delete`, the delete one honouring the same `qcms.allow_answer_delete` door), a CHECK pinning the event vocabulary, and one index serving the roster read.
- **The live-roster derivation, in the API, per count source.** The table records mints and explicit removals; liveness is a function of the count source, and this task owns the function:
  - `open`: every `instance_id` whose latest event is `added`, in first-`added` order.
  - `fixed`: the first `count` of that list.
  - `fromAnswer`: the first N of that list, where N is the current count answer clamped to `min` and `max`.
    It runs **above** `evaluateRules`, so the `rosters` map 071 receives is already truncated and ordered. That is what makes a lowered `fromAnswer` count hide the trailing instance with no `removed` row, and raising it again re-live the same instance with its answers intact, while a removed `open` instance is gone for good.
- **The minting moments**, each one appended `added` row and each idempotent under replay: an `open` group mints `min` instances (or one, when `min` is 0) the first time its step is served and one more per Add; a `fixed` group mints its `count` on first serve; a `fromAnswer` group mints up to the answered N **on the write of the count answer**, and the difference on each later raise. Serving the same step twice mints nothing the second time.
- **The roster read and the add and remove writes as query helpers**, beside the existing answer queries.
- **`eraseSession` and `purgeExpired` reaching the new table** inside the same transaction and behind the same door.
- **The hand-kept `AnswerRow` type and its `_AnswerRowMatchesTable` guard** (issue #5) and **`EXPECTED_TABLES`** in `migrations.test.ts` (issue #861, where the set is exact).
- **The ADR-40 amendment already landed with the plan**, and this task is where its numbers are checked against real SQL: eight data-plane tables, seventeen per-environment guards (four of them from this table: two triggers, one CHECK and one index), eight foreign keys, the two trigger **functions** single in `control`.
- **A changeset** for `@roonga/qcms-db` as a minor: appending a nullable column and a table is additive.

## Exit criteria

Acceptance cases **22 to 26** of `plan/repeating-groups-and-table-input.md` section 11. This task owns those and no others. Plus:

1. An erasure leaves **no row** in `answers`, `submissions` or `answer_group_instances` for that session, asserted **by count against a real Postgres** rather than by reading the code. The erasure table list is hand-kept and a missing entry is silent, which is why this is a criterion and not a deliverable with a checkbox.
2. The retention purge reaches the same table, asserted the same way.
3. The live-roster derivation is tested per count source, including that lowering and raising a `fromAnswer` count restores the **same** instance id and that a removed `open` instance is never restored.
4. `pnpm verify` green, and `pnpm exec turbo run test --force` confirmed to have **executed** rather than served cached output, because the Docker-backed suites are where the triggers and the door are actually proved.

## Files and areas

`packages/db/migrations/` (one appended migration plus its drizzle snapshot), `packages/db/src/schema/`, `packages/db/src/queries/{answers,erasure,retention}.ts`, `packages/db/src/migrations.test.ts`, the roster derivation in `apps/api/src/features/responses/`, one changeset.

## Gates

`pnpm verify`, and the forced Docker-backed run (`pnpm exec turbo run test --force`, confirmed at `0 cached`). No browser gate. Do not run the forced run concurrently with `pnpm verify:browser` on the same checkout: the forced build step rewrites `dist/` under a running harness (issue #863).

## Sequencing against task 064

**This lands first, and it lands as an ordinary appended migration.** Repetition is launch scope and environments (064) are Phase 4, so do not wait for that track and do not write anything conditional on it. The Code Owner's Q41 ruling on issue #995 then has **064 replace migrations 0000 onward with a new baseline**, and that baseline must include `answer_group_instances` with its two triggers, its CHECK, its index and its foreign key, which is where they join ADR-40's per-environment set. So this task writes nothing 064 has to migrate; it writes something 064 has to **carry into the baseline**. The counts in ADR-40's amendment are what 064 checks its generator against, and **the reconciliation between the two tracks is done**: the repetition work landed second and wrote the combined figures, so ADR-40, `plan/environments-and-workspaces.md` and `plan/repeating-groups-and-table-input.md` all state **eight data-plane tables, seventeen guards, eight foreign keys and twenty-five objects** per environment. Nothing is left for a later change to settle.

## Out of scope (binding)

The per-environment generator itself (064). Any change to the `answers` value encoding. Any second whole-session delete path: ADR-17 says there are two and this adds none. The compiler, the renderer and both respondent paths (073). The reporting view and the export (075): this task adds the column, and 075 is what reads it downstream.

## Notes for the executor

**The erasure list is the silent one.** Adding a data-plane table without adding it to `eraseSession` leaves the shape of a respondent's household behind after an erasure request has been answered. Write the counting assertion first, against a session that has a roster, and watch it fail.

**`EXPECTED_TABLES` is an exact set since issue #861**, so the suite tells you immediately if the migration and the mirror disagree. That is a feature; do not relax it.
