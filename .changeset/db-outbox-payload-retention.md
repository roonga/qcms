---
"@qcms/db": minor
---

Give `outbox.payload` a retention story for the ordinary case, not just for erasure
(issue #329).

A `response.submitted` event carries the respondent's **whole locked answer set**, so
every submitted response left a second full copy of its answers in plaintext `jsonb`
next to the answer ledger, and nothing ever removed it. Task 059 made erasure reach
that copy, but erasure is a request somebody has to make: for every response without
one, the answers stayed indefinitely, outside whatever retention policy an operator
believed they had configured.

`redactAgedOutboxPayloads(exec, olderThan)` is the time-based half, and it rides the
API's existing retention-sweep scheduler rather than a new one
(`QCMS_OUTBOX_PAYLOAD_TTL_MS`, default `DEFAULT_OUTBOX_PAYLOAD_RETENTION_MS` = 30
days, `0` supported). It drops the `answers` member and stamps `payload_redacted_at`,
keeping the envelope (`sessionId`, `formId`, `formVersion`, `submittedAt`,
`contentHash`), the event type and the whole delivery record - existence without
content, the same principle the tombstone applies one table over.

The window is the **redelivery window**, because that is the only thing the stored
payload is for. A row is eligible once the event has been consumed (or dead-lettered)
*and* every `webhook_deliveries` row for it has been delivered, dead-lettered or
cancelled, all of it before the horizon. An unconsumed event is never touched, because
redacting one would silently drop a submission that never left; a pending delivery
blocks its parent, because the delivery claim joins this payload and skips redacted
rows, so redacting under it would strand that delivery as "pending" forever. A manual
redelivery restarts the clock.

No backfill migration, and none is missing: the predicate is over `delivered_at`,
`dead_lettered_at` and `cancelled_at`, columns every existing row already carries, so
the first sweep after an upgrade covers the entire back catalogue - which is the data
the issue is about.

Migration `0016` adds `CHECK (payload_redacted_at is null or not jsonb_exists(payload,
'answers'))`. Every control reads that marker as proof the answers are gone - both
claim queries, the redeliver refusal and the sweep itself skip a marked row - so a
writer that stamped it without dropping `answers` would leave a full answer set in a
row nothing ever looks at again. Both redaction paths now write the pair through one
shared column set, and the database refuses any row that does not.

Also in this change, in `qcms-api`: the redelivery refusal
`409 DELIVERY_SESSION_ERASED` becomes `409 DELIVERY_NOT_REDELIVERABLE`, "The response
this delivery carries is no longer held, so it will not be re-sent". The old code and
sentence were accurate only while erasure was the sole producer of
`payload_redacted_at`; this sweep is a second producer, and they would have told an
operator a response was erased when it merely aged out.
