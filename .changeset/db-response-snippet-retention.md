---
"@qcms/db": minor
---

Give `webhook_deliveries.last_response_snippet` a retention story: erasure removes it,
and the retention sweep ages it out (issue #304).

That column keeps up to 500 bytes of the **consumer's** response body so an operator
can see why a webhook is failing. A consumer that rejects a malformed request commonly
quotes the request back in its error, and the request is the respondent's answers - so
the column can hold somebody's answers without QCMS ever choosing to write them, and
nothing removed them. It is the one column on the delivery row that is not
structurally value-free, and it was the one with no policy.

Two producers, one mechanism:

- `eraseSession` now clears the snippet on every delivery of the erased session's
  events, in the same transaction as the payload redaction and the cancellations.
  **Delivered rows included**, unlike the cancellation, which deliberately spares them:
  cancellation is a statement about what will happen next, and this is a statement
  about what we still hold. A successful `200` body can echo the request too.
- New `redactAgedResponseSnippets(exec, olderThan)` removes any snippet whose attempt
  is older than the horizon. The API runs it from its existing retention-sweep
  scheduler (`QCMS_DELIVERY_SNIPPET_TTL_MS`, default `DEFAULT_RESPONSE_SNIPPET_RETENTION_MS`
  = 7 days) rather than gaining a second scheduler for a second retention rule.

Seven days is where the data's justification expires rather than a number picked for
feel: a delivery exhausts its ten retries in a little over a day, so by then the row
has been fixed and redelivered (which clears the whole attempt record anyway) or
abandoned. `0` is supported and means "at the next sweep". Nothing else in the attempt
record is touched at any setting: `last_status`, `last_latency_ms`, `last_error`, the
masked headers and the timestamps are value-free and are kept, so the audit question
stays answerable.

Migration `0014_response_snippet_retention` adds one nullable column,
`last_response_snippet_redacted_at`, surfaced on `DeliveryView`. It exists because
`last_response_snippet` is already null in three other situations (no response
arrived, an empty body, a row reset for redelivery), so without it a screen would
report an empty body for one that was deleted. It carries **no cause** by design: with
two producers, a marker naming one would be false the moment the other wrote it.

**No backfill is needed and none is missing.** The sweep's predicate is
`last_attempt_at`, which every existing row already has, so a row written before this
control existed is more eligible than a fresh one and the first sweep after an upgrade
covers the whole back catalogue.

Migration `0015_snippet_requires_attempt` makes that predicate's precondition
structural: `CHECK (last_response_snippet IS NULL OR last_attempt_at IS NOT NULL)`.
Under three-valued logic `last_attempt_at < horizon` is never true for a NULL, so a
row carrying a snippet with no attempt time would be skipped by every sweep forever -
the leak the retention story exists to close, reappearing through the control itself.
`attemptColumns` pairs the two today and types both as required, but a convention held
up by one call site cannot fail when a future writer breaks it, so the database refuses
the row instead. The constraint permits every shape the delivery path writes: neither
column set (a materialized row), an attempt with a body, and an attempt with none (the
timeout shape).

`resetDeliveryForRedelivery` clears the new marker with the rest of the attempt
record. `redeliveryRefusalFor` is unchanged and still reads only `cancelled_at` and
`payload_redacted_at`, so a delivery whose snippet merely aged out stays redeliverable
and the erasure-specific `DELIVERY_SESSION_ERASED` answer keeps meaning erasure.

Additive and backward-compatible: the new column is nullable and existing rows read as
"not redacted".
