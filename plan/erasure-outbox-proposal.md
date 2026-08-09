# Proposal: erasure must reach QCMS's own outbox copy (ADR-17 amendment + task 059)

**Status:** LANDED 2026-08-06 on the Code Owner's approval. Artifact 1 is the `**Amendment (2026-08-02, ...)**` block appended to `### ADR-17` in `docs/PROJECT_GOAL.md`; Artifact 2 is `docs/features/059-erasure-reaches-the-outbox.md`, with a ledger row and a `059 | before 040` ordering exception in `docs/features/README.md`. This file is kept as the reasoning trail: the evidence, the rejected alternatives, and the R3/I5 argument that the landed artifacts only summarize. Drafted by the PM/PO seat 2026-08-02.

**Found by:** the PO review of PR #284 (task 035), 2026-08-02. Two review passes converged on it independently and the conductor re-derived it before dispatching, so the gap is confirmed by three separate readings of the code rather than one.

---

## The gap, in four lines of evidence

- `apps/api/src/features/responses/submit/handler.ts` enqueues `response.submitted` with `answers: locked.answers` - the complete locked answer set - into `outbox.payload` (jsonb, notNull).
- `packages/db/src/queries/erasure.ts` `eraseSession` deletes `answers` and `submissions` and writes a tombstone. It touches neither `outbox` nor `webhook_deliveries`.
- `packages/db/src/queries/deliveries.ts` `claimDueDeliveries` selects `payload: outbox.payload` and filters only on `deliveredAt` / `deadLetteredAt` / `nextAttemptAt`. There is no tombstone anti-join, and `git grep -in tombstone` across the delivery and outbox paths returns zero hits.
- Nothing ever deletes an outbox row. `markDelivered` is an UPDATE; `purgeExpired` sweeps only expired-never-submitted sessions (`status = "expired"` AND `isNull(submissions.sessionId)`), so it was never going to reach submitted answers by design; `queries/outbox.ts` exports no delete at all.

Consequence: an erased respondent's answers remain in QCMS's own database indefinitely, and a delivery that was pending or dead-lettered at erasure time will still be sent - by the scheduler on its next pass, or by the operator pressing the Redeliver button that task 035 introduces.

This lands on a named control: `docs/SECURITY_DESIGN.md` line 127 lists "ADR-17 hard erasure + tombstone + reporting exclusion (016, 023, **035**)".

## Why the existing ADR reads as if this were already settled

ADR-17's consequences say: *"Webhook consumers are documented as independent data controllers - erasure does not propagate downstream."* That sentence is correct and stays. It is about **consumers**. It was then read as covering the whole webhook story, and the copy 035 shipped ("Webhook consumers are not affected") inherited that reading. The distinction the ADR never drew is the one that matters: a consumer's copy is outside our reach, and **our own outbox copy is not**.

## Decision proposed: redact in place, do not delete

Rejected alternative - **delete the outbox and delivery rows for the session.** Simpler, and it does remove the data. But auditability is one of the three non-negotiables, and those rows are the record of what left the building. Delete them and an operator asked *"did this person's data go anywhere?"* has no answer at all. Redact them and the answer is "an event existed, it was delivered to endpoint X at T, here is the tombstone" - which serves a data-subject request better, not worse. It would also mean opening a third sanctioned DELETE door against the append-only grain, for no gain.

Rejected alternative - **crypto-shred the payload.** Consistent with what ADR-17 already rejected for the ledger, and rejected here for the same reason: more machinery for a stronger story nobody has asked for.

**On R3/I5:** redaction is an UPDATE, and ADR-17 says "there is still no UPDATE path, ever". That clause governs the **answer ledger**, not the outbox: `outbox` already takes UPDATEs today (`markDelivered`, and the attempt record 035 adds). Nothing here touches the ledger's append-only guarantee, and the amendment says so explicitly so it cannot be read as an erosion.

---

## Artifact 1 - proposed ADR-17 amendment

> To be appended to `### ADR-17` in `docs/PROJECT_GOAL.md`, after the 2026-07-20 amendment.

**Amendment (2026-08-02, from the task 035 review - erasure reaches QCMS's own outbox copy).** The original consequence "webhook consumers are documented as independent data controllers - erasure does not propagate downstream" stands, and was read too broadly. It governs a **consumer's** copy, which is genuinely outside our reach. It never governed **QCMS's own** copy: `outbox.payload` carries the complete locked answer set of every submitted response, is written in the submit transaction, and is read back out by the delivery scheduler. Nothing deleted or redacted it, so an erased respondent's answers survived erasure in our database and remained deliverable - by the scheduler on its next pass, or by the redeliver control task 035 adds.

Erasure therefore reaches three things, not one:

1. **The ledger and the submission** - hard-deleted, as before, with the tombstone. Unchanged.
2. **QCMS's outbox copy** - the session's `outbox.payload` is **redacted in place**: the envelope (`sessionId`, `formId`, `formVersion`, `submittedAt`, `contentHash`, `eventType`) is kept, the `answers` member is removed, and the row is marked redacted. Existence without content, the same principle the tombstone already applies one table over. The row is **not** deleted: it plus its `webhook_deliveries` children are the audit record of what left the building, and an operator answering "was this person's data sent anywhere?" needs it.
3. **Undelivered deliveries for that session** - terminally **cancelled**, not sent. A delivery still pending or dead-lettered at erasure time is never attempted again, and the redeliver control refuses it. Posting an event whose `answers` member has been removed is a malformed message for the consumer; not sending is the honest outcome.

Already-delivered events stay delivered: that is the part erasure genuinely cannot reach, and it is what the original consequence was about. **Erasure also cannot recall an HTTP request already in flight** - a delivery claimed microseconds before the erasure transaction commits may still complete. That window is narrow and is documented rather than closed; closing it would mean holding a lock across a network call.

This adds **no** new DELETE door: the two sanctioned whole-session DELETE paths remain `eraseSession` and `purgeExpired`. Redaction and cancellation are UPDATEs on `outbox` and `webhook_deliveries`, tables that already take UPDATEs (`markDelivered`, and the delivery attempt record added by 035). The append-only guarantee on the **answer ledger** (R3/I5) is untouched: there is still no UPDATE path there, ever.

**Consequences.** Implemented by task 059, which lands before the 040 security review: erasure that does not erase cannot pass that gate. Task 035's admin copy is a stopgap that describes the pre-059 behaviour truthfully; 059 replaces it with the post-059 statement. `docs/erasure.md`'s "What erasure does NOT cover" section is corrected in the same change - it currently names only downstream controllers and does not mention QCMS's own retained copy. A separate, smaller question is left open deliberately: nothing ever removes a **delivered** outbox row, so every answer set for every response persists in plaintext jsonb indefinitely even with no erasure request outstanding. That is tracked as its own issue, not folded in here.

---

## Artifact 2 - proposed task file

> `docs/features/059-erasure-reaches-the-outbox.md`

# 059 - Erasure reaches the outbox: payload redaction and delivery cancellation

**Stage:** 8b · **Apps/packages:** `@roonga/qcms-db`, `apps/api`, `apps/admin` (copy only) · **Depends on:** 035 (the redeliver control and its tombstone refusal are the seam this generalizes). Independent of 056 and 036 - no ordering relationship, may run in parallel with either.
**References:** ADR-17 as amended 2026-08-02 (the decision this task implements) · the PO review of PR #284, which found the gap and carries the four-line evidence trail · `docs/SECURITY_DESIGN.md` line 127 (this is a named control) · `packages/db/src/queries/erasure.ts`, `queries/deliveries.ts`, `queries/outbox.ts` · `apps/api/src/schedulers/outbox-delivery.ts` · `docs/erasure.md`.

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
7. `pnpm verify` green; `pnpm verify:browser` green (admin copy changes); a changeset for `@roonga/qcms-db`.

## Out of scope

- **Deleting outbox rows.** The ADR chose redaction; do not delete. If the executor finds itself writing a `DELETE` against `outbox` or `webhook_deliveries`, it has overshot and must stop and ask.
- **A retention sweep for delivered outbox rows.** Real, tracked separately as its own issue; not this task.
- **Crypto-shredding**, considered and rejected in the ADR.
- **Closing the in-flight-request window.** Documented as a known limit; closing it would mean holding a lock across a network call.
- **Anything in the admin beyond the two copy surfaces named above.**

## Screenshot gate

The erase dialog copy changes, so the `erase-confirm` frames re-shoot at 390 and 1280 across the three modes, into `docs/gates/059/`, following whatever naming convention 035 lands with.

---

## Open question for the Code Owner

**The separate issue this proposal deliberately does not fold in:** nothing ever removes a delivered outbox row, so every answer set for every response persists in plaintext jsonb indefinitely, with or without an erasure request. Redacting a payload once fan-out is terminal would fix it and is a much smaller change than 059. I would file it as an issue rather than a task and let it ride an issue-loop cycle - but if you would rather it be part of 059, it fits cleanly and adds maybe a third to the task's size.
