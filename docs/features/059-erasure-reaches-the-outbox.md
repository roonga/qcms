# 059 - Erasure reaches the outbox: payload redaction and delivery cancellation

**Stage:** 8b (ordering exception: runs before 040, because erasure that does not erase cannot pass the security review) · **Apps/packages:** `@qcms/db`, `apps/api`, `apps/admin` (copy only) · **Depends on:** 035 (the redeliver control and its tombstone refusal are the seam this generalizes). Independent of 056 and 036 - no ordering relationship, may run in parallel with either.
**References:** ADR-17 as amended 2026-08-02 (the decision this task implements) · the PO review of PR #284, which found the gap and carries the four-line evidence trail · `docs/SECURITY_DESIGN.md` §7 (this is a named control) · `packages/db/src/queries/erasure.ts`, `packages/db/src/queries/deliveries.ts`, `packages/db/src/queries/outbox.ts` · `apps/api/src/schedulers/outbox-delivery.ts` · `docs/erasure.md`.

## Context

`outbox.payload` carries the complete locked answer set of every submitted response. `eraseSession` never touched it, `claimDueDeliveries` reads it with no tombstone check, and nothing anywhere deletes an outbox row. So an erased respondent's answers survived erasure inside QCMS and stayed deliverable - including through the redeliver control 035 added. Task 035 shipped a stopgap: truthful copy plus a redeliver refusal for a tombstoned session. This task closes it at the source and makes the refusal a property of the data rather than of one handler.

## Deliverables

- **Redaction in `eraseSession`.** Inside the existing erasure transaction, rewrite every `outbox` row for the session: keep `sessionId`, `formId`, `formVersion`, `submittedAt`, `contentHash`, `eventType`; remove the `answers` member; mark the row redacted (a nullable `payload_redacted_at` column is the suggested shape - the executor may propose better, but the redacted state must be queryable, not inferred from the payload's shape). Transactional with the rest of erasure: a failure rolls the whole thing back, as I11 already requires.
- **Cancellation of undelivered deliveries.** Every `webhook_deliveries` row for the session that is neither delivered nor cancelled becomes terminally cancelled, with a reason. Do **not** reuse `dead_lettered_at`: a dead letter means retries were exhausted and the dead-letter queue offers it for redelivery, which is the opposite of what this state means. A new nullable `cancelled_at` (plus reason) is the expected shape; migration `0013_*`, additive and nullable only, no backfill.
- **The scheduler cannot claim a cancelled or redacted row.** `claimDueDeliveries` filters cancelled rows out. This is the structural half: after this task a redacted payload has no path to the transport, whatever a future caller does.
- **The redeliver handler refuses cancelled deliveries**, and 035's session-tombstone check is re-expressed in terms of the cancelled state so there is one rule rather than two that can drift.
- **The dead-letter queue excludes cancelled rows**, and the delivery dashboard shows the cancelled state honestly rather than hiding the row - an operator looking for "what happened to that delivery" should find the answer.
- **Admin copy replaced.** The erase dialog's third ADR-17 fact and `docs/erasure.md` move from 035's pre-059 statement to the post-059 one: already-delivered events stay delivered and are the consumer's to handle as an independent controller; undelivered events for this session are cancelled and never sent; QCMS's own stored copy of the answers is redacted. Every clause asserted, per the copy-from-intent rule.
- **`docs/erasure.md` "What erasure does NOT cover" corrected** - it currently names only downstream controllers and is silent on QCMS's own retained copy.
- **`docs/SECURITY_DESIGN.md`** updated where it describes the ADR-17 control, and `docs/webhooks.md` where it describes payload lifetime.

## Exit criteria

1. An integration test erases a session with one delivered, one pending and one dead-lettered delivery, then asserts on the **database rows**: all three outbox payloads carry no `answers` member and are marked redacted; the pending and dead-lettered deliveries are cancelled; the delivered one is untouched apart from redaction.
2. An integration test drives a real delivery pass after an erasure and asserts the consumer receives **nothing** for the erased session, while a second, unerased session in the same pass is delivered normally. This is the assertion PR #284's e2e was one step away from making.
3. A test asserts `claimDueDeliveries` cannot return a cancelled row, and one asserts the redeliver endpoint refuses one with a typed error rather than a 500.
4. Erasure remains atomic: a forced failure after redaction rolls back the deletes, the tombstone and the redaction together (extends the existing I11 test).
5. Every clause of the new erase-dialog copy and the new `docs/erasure.md` text has an assertion behind it, on the rendered surface or on the payload.
6. `docs/PROJECT_GOAL.md` ADR-17 carries the 2026-08-02 amendment; `docs/erasure.md`, `docs/SECURITY_DESIGN.md` and `docs/webhooks.md` updated in this PR.
7. `pnpm verify` green; `pnpm verify:browser` green (admin copy changes); a changeset for `@qcms/db`.
8. The erase dialog copy changes, so the `erase-confirm` frames re-shoot at 390 and 1280 across the three modes, into `docs/gates/059/`, following the naming convention 035 landed with (human gate; the task is not done until signed).

## Out of scope

- **Deleting outbox rows.** The ADR chose redaction; do not delete. If the executor finds itself writing a `DELETE` against `outbox` or `webhook_deliveries`, it has overshot and must stop and ask.
- **A retention sweep for delivered outbox rows.** Real, tracked separately as its own issue; not this task.
- **Crypto-shredding**, considered and rejected in the ADR.
- **Closing the in-flight-request window.** Documented as a known limit; closing it would mean holding a lock across a network call.
- **Anything in the admin beyond the two copy surfaces named above.**
