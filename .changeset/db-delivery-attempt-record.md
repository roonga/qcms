---
"@qcms/db": minor
---

Record what each webhook delivery attempt actually did, and add the form-scoped
delivery listing the admin operations dashboard reads (task 035).

`webhook_deliveries` gains five nullable columns (migration
`0012_delivery_attempt_record`): `last_attempt_at`, `last_status`,
`last_latency_ms`, `last_request_headers` and `last_response_snippet`. None of
that is derivable from the lifecycle timestamps, and an operator screen that
described the request from the deliverer's *intent* rather than from what it sent
would be a fiction the moment either side changed.

`markDeliveryDelivered` and `recordDeliveryFailure` take an optional
`DeliveryAttemptRecord` and persist it; `resetDeliveryForRedelivery` clears the
whole record alongside `lastError`, so a reset row never shows a stale status next
to a cleared error. New `listRecentDeliveries(exec, formId, limit)` returns
`DeliveryView` rows (lifecycle plus the attempt record, joined to event and target),
newest first.

The webhook signature never reaches these columns: the deliverer masks
`x-qcms-signature` before storage, so the HMAC is absent from the database rather
than hidden by a renderer (SEC-6, SEC-13).

Also new: `deliveryTargetsErasedSession(exec, deliveryId)`, a read reporting whether
the session a delivery would transmit carries an erasure tombstone. A
`response.submitted` payload holds the respondent's whole locked answer set, and
`eraseSession` deletes the `answers` rows and the `submissions` lock without touching
`outbox` or `webhook_deliveries` - so the manual redelivery door needs to be able to
refuse. Whether erasure should purge or redact those rows is an ADR-17 amendment
question and is not decided here; `eraseSession`'s deletion scope is unchanged.

Additive and backward-compatible: the new columns are nullable, the new parameters
are optional, and existing rows read as "no attempt recorded".
