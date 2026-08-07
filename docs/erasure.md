# Erasure (right-to-erasure) - operator guide

Erasure is QCMS's answer to a data-subject erasure request (GDPR Art. 17 and
equivalents). It **hard-deletes** a single respondent session's content and
leaves a **tombstone** proving that a response existed - against which form
version, and when it was erased - without preserving any of the content.

It reaches **three** things, not one (ADR-17 as amended 2026-08-02, task 059):
the answer ledger and the submission, QCMS's own copy of the answers in the
webhook outbox, and any undelivered webhook delivery for that session.

Design decision: **ADR-17** (hard delete + tombstone; crypto-shredding rejected
for launch). Invariant **I11**. Semantics are owned by `@qcms/core`
(`src/erasure.ts`); execution by `@qcms/db` (`eraseSession`).

## What erasure does

Given a `sessionId` and an operator `reason`, `eraseSession` runs one
transaction that:

1. **Deletes the answer ledger** - every `answers` row for the session (all
   revisions, not just the latest).
2. **Deletes the submission lock** - the `submissions` row, if the session was
   submitted.
3. **Scrubs respondent-linkable session columns** - see
   [What is retained](#what-is-retained). In the launch schema this set is
   empty; the (now content-free) session row is retained as an audit shell.
4. **Redacts QCMS's own outbox copy** - every `outbox` row whose payload names
   this session keeps its envelope (`sessionId`, `formId`, `formVersion`,
   `submittedAt`, `contentHash`) and loses its `answers` member, and the row is
   stamped `payload_redacted_at`. Existence without content, the same principle
   the tombstone applies one table over. The row is **not** deleted: it and its
   `webhook_deliveries` children are the audit record of what left the building.
5. **Cancels every undelivered delivery** - each `webhook_deliveries` row for
   those events that is neither delivered nor already cancelled gets
   `cancelled_at` and `cancelled_reason = 'session_erased'`. It will never be
   attempted again.
6. **Writes a tombstone** - one `erasure_tombstones` row
   `(session_id, form_id, form_version, erased_at, reason)`.

It is **idempotent**: erasing an already-erased session is a no-op that returns
the existing tombstone. Erasing a session that never existed throws a typed
`SessionNotFoundError` (`code: "SESSION_NOT_FOUND"`).

All six steps are one transaction: an induced failure at any point (e.g. a
constraint or trigger error on the tombstone insert, which runs last) rolls the
deletes, the redaction and the cancellations back together - the ledger stays
intact, the payloads still hold their answers, and no tombstone is written.

### Why the cancelled state is its own column

`cancelled_at` is deliberately not `dead_lettered_at`. A dead letter means
retries were exhausted and the dead-letter queue is offering the row **back**
for redelivery; a cancelled delivery is one nobody may ever send. Reusing the
column would have made those two the same value.

The cancellation is enforced structurally, not by convention:

- `claimDueDeliveries` (the scheduler's claim) filters out cancelled rows **and**
  rows whose outbox payload is redacted, so a redacted payload has no path to the
  transport whatever a future caller does.
- `claimDue` (the fan-out claim) filters out redacted rows, so a session erased
  *before* its event was fanned out never gets a delivery row at all.
- `POST /admin/outbox/:id/redeliver` reads exactly those two columns and answers
  `409 DELIVERY_SESSION_ERASED`. One rule, stated in the two places it has to
  hold, rather than a separate tombstone lookup that could drift from what the
  scheduler actually does.
- The dead-letter queue excludes cancelled rows, because every row on it is being
  offered for redelivery. The **delivery dashboard** still shows them, with the
  status and the reason, so an operator asking "what happened to that delivery"
  finds an answer rather than a missing row.

## What is retained

- **The form snapshot** (`form_versions`): the immutable published definition and
  compiled UI. It contains no respondent data (R1) and is never touched.
- **`link_id`** on a secure-link session: it identifies the *link*, not the
  person. **Warning to adopters:** do not encode PII in how you distribute links
  (e.g. a per-recipient link identity that itself embeds a name or email). The
  link identifier survives erasure by design; keep it opaque.
- **The scrubbed `sessions` row**: an audit shell recording that a session
  against a form version existed. It holds no respondent content after erasure.
- **The tombstone**: existence without content. It has no foreign key to
  `sessions`, so it survives even if a later retention purge removes the scrubbed
  session shell.

### Scrubbed session columns

The launch `sessions` table holds **no free-form respondent PII** - its columns
are structural (`session_id`, `form_id`, `form_version`, `access_mode`,
`status`, `expires_at`, `created_at`) - so **the scrub set is currently empty**.
If you extend the `sessions` table with respondent-identifying columns, you must
extend the scrub in `eraseSession` to null them; otherwise they will survive
erasure.

## Reporting exclusion

`reporting.responses` and `reporting.answers_flat` exclude erased sessions **two
ways, independently**:

- the submission hard-delete removes the row (the views are built from
  `submissions`), and
- a tombstone anti-join (`LEFT JOIN erasure_tombstones ... IS NULL`) excludes any
  session that has a tombstone, even before its content is deleted.

Either alone is sufficient; both hold after `eraseSession`.

## The sanctioned DELETE door (why DELETE on `answers` is guarded)

The answer ledger is append-only (I5): there is no UPDATE path, and migration
`0001` rejects UPDATE at the database level. Erasure is the *only* amendment -
whole-session DELETE. (Clearing one answer is **not** an amendment: it appends a
retraction row, ADR-33, which erasure then deletes with every other row of the
session.) To keep that door narrow, migration `0004` installs a
`BEFORE DELETE` trigger (`answers_reject_delete`) that **rejects any DELETE on
`answers`** unless the transaction-local setting `qcms.allow_answer_delete` is
`'on'`.

Only the **two sanctioned whole-session delete paths** set that flag (via
`set_config('qcms.allow_answer_delete', 'on', true)` inside their transaction):

- **`eraseSession`** (task 016) - this erasure path.
- **`purgeExpired`** (task 015) - the optional retention hard-cleanup of
  expired, never-submitted sessions.

`SET LOCAL` reverts when the transaction ends, so the door is never left open
across statements or connections. Any ad-hoc `DELETE FROM answers` outside a
transaction that has opened the door is rejected. (See issue #4.)

## Where an operator performs it (task 035)

Erasure has one door in the app, and it is on the **response detail** - the screen
showing the answers that are about to go, so nobody erases from a list of ids. Pressing
"Erase respondent data" opens a type-to-confirm dialog that states three separate facts
rather than asking for certainty: what is deleted (every answer and the submission, with
no undo, no soft delete, and nothing this screen can restore from), what remains (the
tombstone below), and what happens to the webhook copies: an event already delivered
stays delivered and is the consumer's to erase as an independent controller, an event
not yet delivered is cancelled and never sent, and QCMS's own stored copy of the answers
is redacted.
The destructive button stays disabled until the operator retypes the session id exactly,
so there is no single-click path to it.

The reason is chosen from a closed set - data subject request, retention policy, entered
in error - rather than typed. The reason lands on a tombstone that outlives the data it
describes, so a free-text box would invite a data subject's name into an audit record.

Afterwards the same URL keeps working and shows the tombstone: an operator with the link
in a ticket gets "this was erased, here is the record" rather than a 404. Every tombstone
is also listed at **/responses/erasures**, which is the compliance evidence - a screen
that can be shown to whoever asks whether a request was honoured, because it holds no
answers to leak.

## What erasure does NOT cover

Erasure is honest about its boundaries. It does **not**:

- **Propagate to webhook consumers.** Anyone you delivered `response.submitted`
  events to (via the outbox) is an **independent data controller**. Erasure does
  not call them back; you must run your own downstream-erasure process against
  those systems. This is about a **consumer's** copy, which is genuinely outside
  our reach. It never governed QCMS's own copy - see below.
- **Remove the envelope from QCMS's retained copy.** Erasure redacts the outbox
  payload rather than deleting the row, so what stays behind is the session id,
  the form, the version, the submission time and the content hash of an event that
  existed. That is deliberate, and it is the same trade as the tombstone: an
  operator answering "was this person's data sent anywhere?" needs the record.
  What is gone is the `answers` member, which is the content. If your threat model
  cannot tolerate the retained session id, note that the tombstone carries it too,
  by design.
- **Reach a delivered outbox row for a session nobody asked to erase.** Nothing
  removes a **delivered** outbox row today, so every answer set for every response
  persists in plaintext `jsonb` indefinitely when no erasure request is
  outstanding. That is a retention gap rather than an erasure gap, tracked as issue
  #329; its fix reuses this task's redaction mechanism once fan-out is terminal.
- **Recall an HTTP request already in flight.** A delivery claimed microseconds
  before the erasure transaction commits may still complete: the deliverer holds
  the row lock across the POST, so the request is already on the wire. The window
  is narrow and is documented rather than closed - closing it would mean holding a
  lock across a network call. An operator who needs certainty about a specific
  event can confirm it afterwards on the delivery dashboard, which shows whether
  the row ended up `delivered` or `cancelled`.
- **Reach physical backups, WAL, or replicas immediately.** A hard delete in the
  primary does not retroactively rewrite base backups, write-ahead logs, or
  streaming replicas. Those copies age out per **your** backup-retention policy.
  Document that retention window in your privacy notice; a subject's content is
  fully gone once the last backup covering the erasure moment has expired.
- **Crypto-shred.** Per ADR-17, launch uses plain hard delete, not per-record
  encryption keys destroyed on erasure. This was a deliberate trade: simpler and
  testable, at the cost of the stronger "physically unrecoverable the instant the
  key is dropped" story. Revisit only if an adopter requirement demands it.
