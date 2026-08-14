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
6. **Removes the stored response snippets** - every `webhook_deliveries` row for
   those events loses `last_response_snippet` and is stamped
   `last_response_snippet_redacted_at`. See
   [The webhook response snippet](#the-webhook-response-snippet) for why that
   column can hold respondent content at all.
7. **Writes a tombstone** - one `erasure_tombstones` row
   `(session_id, form_id, form_version, erased_at, reason)`.

It is **idempotent**: erasing an already-erased session is a no-op that returns
the existing tombstone. Erasing a session that never existed throws a typed
`SessionNotFoundError` (`code: "SESSION_NOT_FOUND"`).

All seven steps are one transaction: an induced failure at any point (e.g. a
constraint or trigger error on the tombstone insert, which runs last) rolls the
deletes, the redaction and the cancellations back together - the ledger stays
intact, the payloads still hold their answers, and no tombstone is written.

### The webhook response snippet

`webhook_deliveries.last_response_snippet` keeps up to 500 bytes of the
**consumer's** response body for each delivery attempt, so an operator can see why
a webhook is failing. QCMS never puts respondent data there deliberately - but a
consumer that rejects a malformed request commonly quotes the request back in its
error, and the request is the respondent's answers. So the column can end up
holding somebody's answers without QCMS ever choosing to write them.

That makes it the one column on the delivery row that erasure has to reach, and
step 6 above is that reach. Two properties are worth stating explicitly:

- **Delivered rows too**, unlike the cancellation in step 5. The two answer
  different questions. Cancellation is a statement about what will happen next, and
  pretending a sent event was not sent would be a fiction; the snippet is a
  statement about what we still hold, and a successful `200` response can echo the
  request just as a rejected `400` can.
- **The rest of the attempt record stays.** `last_status`, `last_latency_ms`,
  `last_error`, the (already signature-masked) request headers and every timestamp
  are structurally value-free, so an operator can still answer "was this person's
  data sent anywhere, and did it arrive". Only the free-text body goes.

The column also ages out for **everybody**, erasure request or not - see
[Retention of the response snippet](#retention-of-the-response-snippet).

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
- `POST /admin/forms/:id/deliveries/:deliveryId/redeliver` reads exactly those two
  columns and answers
  `409 DELIVERY_NOT_REDELIVERABLE`. One rule, stated in the two places it has to
  hold, rather than a separate tombstone lookup that could drift from what the
  scheduler actually does. The code is cause-free because the state has two
  producers: since issue #329 a payload can also be redacted by retention, and a
  code naming erasure would be a false statement for those (see below).
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

## Retention of the response snippet

Erasure is on request. `last_response_snippet` also has a **time-based** default,
because a column that can hold a respondent's own words should not be kept forever
merely because nobody filed a request.

`redactAgedResponseSnippets` removes any stored snippet whose attempt is older than
`QCMS_DELIVERY_SNIPPET_TTL_MS` (default **7 days**) and stamps
`last_response_snippet_redacted_at`. It runs on the API's existing
**retention-sweep scheduler** (`QCMS_RETENTION_SWEEP_INTERVAL_MS`, default hourly)
rather than a scheduler of its own.

**Why seven days, and why a window at all.** The snippet exists to answer one
operator question: "why did this attempt fail, so I can fix the consumer and
redeliver it". That question has a lifetime. A delivery exhausts its ten retries in
a little over a day, so by day seven the row has either been fixed and redelivered
(which clears the whole attempt record anyway) or been abandoned. After that the
bytes answer nothing anybody is asking, and what remains is only the risk that they
contain an echoed answer. The window is the moment the data's justification expires,
not a number picked for feeling about right.

**`0` is a supported setting.** An operator running strict data minimisation, who
would rather lose the diagnostic than hold a consumer's response body at all, sets
`QCMS_DELIVERY_SNIPPET_TTL_MS=0` and the next sweep removes every snippet it finds.
The rest of the attempt record is unaffected at any setting.

**No backfill migration is needed, and none is missing.** The sweep's predicate is
`last_attempt_at`, a column every existing row already has, so a row written long
before this control existed is *more* eligible than a fresh one: the first sweep
after an upgrade covers the entire back catalogue. A retention control that governed
only rows created after it shipped would have left exactly the data this is about.

**The predicate's precondition is enforced by the database.** Migration `0015` adds
`CHECK (last_response_snippet IS NULL OR last_attempt_at IS NOT NULL)`. Ageing from
`last_attempt_at` requires every row holding a snippet to have one: under SQL's
three-valued logic `last_attempt_at < horizon` is never true for a NULL, so such a row
would be skipped by every sweep forever - the leak this control exists to close,
reappearing through the control itself. The delivery path pairs the two columns today,
but a convention held up by one call site cannot fail when a future writer breaks it,
so the database refuses the row rather than the sweep quietly passing over it. The
constraint permits every shape the delivery path actually writes: a materialized row
with neither, an attempt with a body, and an attempt with none (a timeout).

**The marker is deliberately cause-free.** `last_response_snippet_redacted_at`
records *that* a body was removed, never *why*, because it has two producers -
erasure and this sweep - and a marker naming one would be a false statement the
moment the other wrote it. Where the cause matters the row already carries it: an
erased session's undelivered deliveries hold `cancelled_reason = 'session_erased'`,
and the tombstone is the record that the erasure happened at all.
(`payload_redacted_at` on the outbox parent is *not* that evidence: since issue #329
it has two producers of its own.) The admin delivery dashboard
reads the marker and says the body was removed, rather than reporting an empty body
for one that was deleted.

It is **not** a redelivery refusal. `redeliveryRefusalFor` still reads exactly
`cancelled_at` and `payload_redacted_at`, so a delivery whose snippet merely aged out
is still redeliverable.

## Retention of the outbox payload

The same argument applies one table over, and with more at stake. `outbox.payload`
for a `response.submitted` event carries the respondent's **whole locked answer
set**: QCMS's own second copy of the ledger, written so a delivery can be re-sent.
Erasure reaches it on request (above), but until issue #329 nothing reached it
otherwise, so every response ever submitted left a full copy of its answers in
plaintext `jsonb` indefinitely, outside whatever retention policy an operator
believed they had configured.

`redactAgedOutboxPayloads` drops the `answers` member and stamps
`payload_redacted_at`, keeping the envelope (`sessionId`, `formId`, `formVersion`,
`submittedAt`, `contentHash`) and the event type. It runs on the same
**retention-sweep scheduler** as the two rules above: one sweep with three jobs is
auditable, three sweeps drift.

**The window is the redelivery window** (`QCMS_OUTBOX_PAYLOAD_TTL_MS`, default **30
days**, `0` supported). The payload exists so an operator can re-send a delivery, so
its justification expires with that capability rather than on a date somebody picked.
The clock starts when the event **and its whole fan-out** have settled:

- the event has been consumed by the fan-out pass (`delivered_at`) or dead-lettered,
  and
- every `webhook_deliveries` row for it has been delivered, dead-lettered or
  cancelled, and settled before the same horizon.

Both halves are load bearing. An unconsumed event still has to go somewhere, and
redacting one would silently drop a submission that never left: a stuck queue is an
operations problem, not a retention one. A delivery still pending is one the
scheduler is about to send, and its claim joins this payload and skips redacted rows,
so redacting under it would leave it reading "pending" on the dashboard forever while
nothing ever sent it. Redelivering a dead letter restarts the clock, because that is
the capability being kept alive.

**What ageing out costs is deliberately small.** The envelope, the event type and the
whole delivery record survive, so "did this response's event exist, where did it go,
and did it arrive" is still answerable. Only the answers go - and the answer ledger
itself is untouched by any of this; retention of *that* is the session sweep.

**No backfill migration is needed, and none is missing**, for the same reason as the
snippet: the predicate is over `delivered_at`, `dead_lettered_at` and `cancelled_at`,
columns every existing row already carries, so the first sweep after an upgrade
covers the whole back catalogue - which is precisely the data issue #329 is about.

**The marker's meaning is enforced by the database.** Migration `0016` adds
`CHECK (payload_redacted_at IS NULL OR NOT jsonb_exists(payload, 'answers'))`. Every
control reads the marker as proof the answers are gone: the two claim queries, the
redeliver endpoint and the sweep itself all skip a marked row. So a writer that
stamped the marker without dropping `answers` would leave a full answer set in a row
nothing ever looks at again - this control's own leak, through this control. Both
redaction paths write the pair together, but a call-site convention cannot fail when
a future writer breaks it, so the database refuses the row instead.

**The refusal an operator meets.** Once a payload is redacted the delivery cannot be
re-sent, and `POST /admin/forms/:id/deliveries/:deliveryId/redeliver` answers
`409 DELIVERY_NOT_REDELIVERABLE`. Unlike the erasure case this is no race: a dead
letter older than the window sits on the queue looking redeliverable until it is
pressed. The code and the sentence name the **state** ("the response this delivery
carries is no longer held") rather than a cause, because erasure and retention are
indistinguishable from the row by design, and an operator can act on neither
differently.

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
