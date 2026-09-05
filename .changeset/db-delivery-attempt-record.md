---
"@roonga/qcms-db": minor
---

Record what each webhook delivery attempt actually did, and add the form-scoped
delivery listing the admin operations dashboard reads (task 035).

`webhook_deliveries` gains five nullable columns (migration
`0012_delivery_attempt_record`): `last_attempt_at`, `last_status`,
`last_latency_ms`, `last_request_headers` and `last_response_snippet`. None of
that is derivable from the lifecycle timestamps, and an operator screen that
described the request from the deliverer's _intent_ rather than from what it sent
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

The manual redelivery door also gains the ability to refuse a delivery whose session
has been erased: a `response.submitted` payload holds the respondent's whole locked
answer set, so an operator clearing a stuck queue must not be the reason those answers
reach a consumer. The helper that answers this is `redeliveryRefusalFor(exec,
deliveryId)`, added in the same unreleased line by task 059 - which also changed what
erasure does to those rows. Read that entry for the full story; no published release
carried an earlier spelling of this helper.

Additive and backward-compatible: the new columns are nullable, the new parameters
are optional, and existing rows read as "no attempt recorded".
