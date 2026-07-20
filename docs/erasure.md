# Erasure (right-to-erasure) - operator guide

Erasure is qcms's answer to a data-subject erasure request (GDPR Art. 17 and
equivalents). It **hard-deletes** a single respondent session's content and
leaves a **tombstone** proving that a response existed - against which form
version, and when it was erased - without preserving any of the content.

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
4. **Writes a tombstone** - one `erasure_tombstones` row
   `(session_id, form_id, form_version, erased_at, reason)`.

It is **idempotent**: erasing an already-erased session is a no-op that returns
the existing tombstone. Erasing a session that never existed throws a typed
`SessionNotFoundError` (`code: "SESSION_NOT_FOUND"`).

All four steps are one transaction: an induced failure at any point (e.g. a
constraint or trigger error on the tombstone insert) rolls the deletes back -
the ledger stays intact and no tombstone is written.

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
whole-session DELETE. To keep that door narrow, migration `0004` installs a
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

## What erasure does NOT cover

Erasure is honest about its boundaries. It does **not**:

- **Propagate to webhook consumers.** Anyone you delivered `response.submitted`
  events to (via the outbox) is an **independent data controller**. Erasure does
  not call them back; you must run your own downstream-erasure process against
  those systems.
- **Reach physical backups, WAL, or replicas immediately.** A hard delete in the
  primary does not retroactively rewrite base backups, write-ahead logs, or
  streaming replicas. Those copies age out per **your** backup-retention policy.
  Document that retention window in your privacy notice; a subject's content is
  fully gone once the last backup covering the erasure moment has expired.
- **Crypto-shred.** Per ADR-17, launch uses plain hard delete, not per-record
  encryption keys destroyed on erasure. This was a deliberate trade: simpler and
  testable, at the cost of the stronger "physically unrecoverable the instant the
  key is dropped" story. Revisit only if an adopter requirement demands it.
