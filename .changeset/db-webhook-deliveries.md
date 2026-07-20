---
"@qcms/db": minor
---

Add the `webhook_deliveries` table (migration 0007) and its shape-preserving
query helpers for the webhook deliverer (task 025). One `response.submitted`
outbox event fans out to every active webhook a form has, and each fan-out target
needs **independent** retry/backoff/dead-letter state — one webhook failing must
not stall the others — so the unit of delivery is a `(outbox_id, webhook_id)`
delivery row, not the outbox row.

Helpers: `insertDelivery` (idempotent materialization via the `(outbox_id,
webhook_id)` unique key), `claimDueDeliveries` (`FOR UPDATE OF webhook_deliveries
SKIP LOCKED`, joined to event + webhook so the caller can POST without extra
reads), `markDeliveryDelivered`, `recordDeliveryFailure` (reuses the outbox
`computeBackoff` schedule), `listDeadLetterDeliveries`, and
`resetDeliveryForRedelivery`. Derived status (pending/delivered/dead-lettered) is
a function of the timestamp columns — no redundant stored enum. Additive migration
only; 0000–0006 are untouched.
