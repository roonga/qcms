---
"@qcms/db": minor
---

Add the query-helper vocabulary the API slices call (task 014): typed,
shape-preserving reads and writes over the operational schema. Every helper
takes a Drizzle handle or transaction as its first argument, so slices own
transaction boundaries (R3) - no business logic, validation, or rule evaluation
lives here (that is `@qcms/core`'s job, R5).

Helpers cover questions/versions (create, version, publish, deprecate, get,
list-latest, `isQuestionIdTaken` incl. historic answer use for R6), forms
(create, draft upsert/get/delete, `insertFormVersion` with all stamps, get/
latest/list, `closeForm`/`reopenForm`), sessions (`createSession` pinning the
form version with no mutation path - I4 is structural, get, status transitions,
`expireSessions`), secure links (insert, get, atomic one-time `consumeSecureLink`,
revoke), answers (append-only `appendAnswer`, `latestAnswers` → `AnswerMap`,
`answerLedger`), submissions (`insertSubmission`), and the transactional outbox
(`enqueue`, `claimDue` via `FOR UPDATE SKIP LOCKED`, `markDelivered`,
`recordFailure` with an exponential-backoff schedule - 1m/5m/25m/125m capped at
6h, dead-letter after 10 attempts, `listDeadLetters`, `resetForRedelivery`).

Also adds a `forms.status` lifecycle column (`open`/`closed`, default `open`) via
migration `0002`, backing `closeForm`/`reopenForm` - the §4.1 "closed to new
sessions" state the operational schema previously did not persist.
