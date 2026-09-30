---
"@roonga/qcms-db": minor
---

Key the answer ledger by instance and add the roster table (task 072, ADR-42;
ADR-33 and ADR-40 as amended 2026-09-29; SEC-16).

A repeating group is answered once per **instance**, so the ledger's grain widens
from `(session, question)` to `(session, question, instance)` and the roster of
which instances exist gets a table of its own. Migration `0022_instance_ledger`
is **appended** to the existing chain and is additive in both halves: an adopter
applies it and nothing is backfilled, because a question outside every repeating
group carries `NULL` in the new column, which is what every existing row already
holds.

- **`answers.instance_id text NULL`.** `latestAnswers` resolves the latest row per
  `(question_id, instance_id)` and returns an `AnswerMap` keyed by
  `AnswerKey` - a bare `questionId` outside a group, `instanceId/questionId`
  inside one - so a question that is not repeated reads back exactly as it did.
  `appendAnswer` and `retractAnswer` take an optional `instanceId`; a retraction
  clears one cell alone. The index
  `answers_session_question_answered_at_idx` keeps its name and gains
  `instance_id` before `answered_at`. The `value` encoding is untouched: no
  sentinel and no index inside the JSON, on migration 0009's own precedent.
- **`answer_group_instances`**, append-only: `id`, `session_id` (foreign key into
  `sessions`), `group_id` (no foreign key, like `question_id`), `instance_id`,
  `event` in `('added','removed')` and `occurred_at`. It carries the answer
  ledger's two guards - `answer_group_instances_reject_update` and
  `answer_group_instances_reject_delete`, the delete one honouring the **same**
  `qcms.allow_answer_delete` door - plus a CHECK on the event vocabulary and one
  index serving the roster read. No third whole-session delete path is added:
  ADR-17 still says there are two.
- **`addInstances`, `removeInstance`, `readRoster`, `readRosters` and
  `rosterLedger`.** A removal appends; nothing updates and nothing deletes, so a
  removed instance's answers stay in the ledger and are excluded by the roster
  rather than erased. `readRoster` returns both the instances ever minted and
  those whose latest event is `added`, each in first-added order and each holding
  an id at most once.
- **`eraseSession` and `purgeExpired` reach the new table** inside the same
  transaction and behind the same door, asserted by row count against a real
  Postgres rather than by reading the code.

Deriving the **live** roster from those rows is a function of the group's count
source and runs in the API, above the evaluator; this package stores the events
and reads them back.

**Applying 0022 briefly locks `answers`.** Adding `instance_id` before
`answered_at` means the index `answers_session_question_answered_at_idx` is
dropped and recreated, and the migration runs in one transaction, so the rebuild
is **not** `CONCURRENTLY` and takes an `ACCESS EXCLUSIVE` lock on `answers` for
its duration: answer writes and reads block until it finishes. On a small ledger
this is milliseconds and needs no planning. On a large one, size it first and
apply it in a window, or build the replacement index `CONCURRENTLY` by hand
outside the migration beforehand. `CREATE INDEX CONCURRENTLY` cannot run inside a
transaction block, which is why the migration itself does not use it.
