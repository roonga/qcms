---
"@roonga/qcms-db": minor
---

Erasure now reaches QCMS's own outbox copy: payload redaction and delivery cancellation (task 059, ADR-17 as amended 2026-08-02).

`outbox.payload` for a `response.submitted` event carries the respondent's whole locked
answer set. `eraseSession` never touched it, `claimDueDeliveries` read it with no check,
and nothing deletes an outbox row, so an erased respondent's answers survived erasure in
the database and remained deliverable. This closes that at the source.

Migration `0013_erasure_reaches_outbox` (additive, nullable, no backfill) adds
`outbox.payload_redacted_at`, `webhook_deliveries.cancelled_at` and
`webhook_deliveries.cancelled_reason`. `cancelled_at` is deliberately not
`dead_lettered_at`: a dead letter is offered back for redelivery, which is the opposite
of this state.

- `eraseSession` gains two steps inside its existing transaction. Every `outbox` row
  whose payload names the session keeps its envelope (`sessionId`, `formId`,
  `formVersion`, `submittedAt`, `contentHash`) and loses its `answers` member, stamped
  `payload_redacted_at`; every `webhook_deliveries` row for those events that is neither
  delivered nor already cancelled becomes terminally cancelled with
  `cancelled_reason = 'session_erased'` (exported as `DELIVERY_CANCELLED_SESSION_ERASED`).
  Redaction, never deletion: the rows are the audit record of what left the building, and
  no new DELETE door is added. A failure still rolls the deletes, the redaction, the
  cancellations and the tombstone back together (I11).
- `claimDueDeliveries` excludes cancelled rows **and** rows whose payload is redacted, and
  `claimDue` excludes redacted events from fan-out. A redacted payload therefore has no
  path to the transport whatever a future caller does; this is the structural half, not a
  convention in one handler.
- `listDeadLetterDeliveries` excludes cancelled rows (the queue is a redelivery worklist),
  while `listRecentDeliveries` and `DeadLetterDelivery` / `DeliveryView` carry
  `cancelledAt` and `cancelledReason` so the delivery dashboard shows the state honestly
  rather than dropping the row.
- The redeliver door's guard is now `redeliveryRefusalFor(exec, deliveryId):
Promise<RedeliveryRefusal | undefined>` (`"cancelled" | "payloadRedacted"`), replacing
  `deliveryTargetsErasedSession`. Not a breaking change for anyone: that helper was
  added by task 035 in this same unreleased line, so no published release carried it.
  It reads the same two columns
  `claimDueDeliveries` filters on instead of consulting the tombstone table, so the
  redeliver door's refusal and the scheduler's filter are one rule rather than two that
  can drift.

Operator guidance, including the residual limits (an in-flight request cannot be recalled;
delivered rows for un-erased sessions have no retention sweep yet, issue #329), is in
`docs/erasure.md` and `docs/webhooks.md`.
