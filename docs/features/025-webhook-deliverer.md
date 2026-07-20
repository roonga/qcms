# 025 - Webhook deliverer worker

**Stage:** 6 · **App:** `apps/api` (worker, not a route) · **Depends on:** 020, 024, 014 (outbox helpers), 017 (scheduler shell)
**References:** `ARCHITECTURE.md` §5.3, §11 · review resolutions "outbox worker home", "dead-letter visibility"

## Context

At-least-once, never best-effort. The deliverer drains the outbox the submission transaction wrote, signs requests, retries with backoff, and dead-letters visibly. It runs in-process on the 017 scheduler - no fifth container.

## Deliverables

- Delivery pass: `claimDue(limit)` (`FOR UPDATE SKIP LOCKED` - multi-instance safe) → for each event, resolve the form's active webhooks (024) → POST per webhook:
  - Body: the event payload (020's shape) plus `{ eventId, eventType, deliveredAt }` envelope.
  - Headers: `X-QCMS-Event`, `X-QCMS-Delivery` (unique per attempt), `X-QCMS-Timestamp`, `X-QCMS-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>` - timestamped to prevent replay; document the verification recipe with a copy-paste consumer example (Node and .NET).
  - Success = 2xx within timeout (10s default). Anything else → `recordFailure` (backoff per 014; dead-letter after max attempts).
- Per-(event, webhook) delivery state: one event fanning out to N webhooks tracks each independently (extend the outbox model with a `deliveries` table if cleaner - coordinate with 013/014 via a follow-up migration in this task).
- `POST /admin/outbox/:id/redeliver` - `resetForRedelivery` on a dead-letter; `GET /admin/outbox/dead-letters` - list with lastError and attempt history (035 renders this).
- At-least-once documented for consumers: duplicates possible (redelivery, crash-after-send); `eventId` + `contentHash` are the idempotency keys.
- Delivery loop metrics in logs: per-pass counts (claimed, delivered, failed, dead-lettered) as structured fields.

## Exit criteria

1. Integration test with an in-test HTTP receiver: submit (020) → signed request arrives; signature verifies against the documented recipe; tampered body fails verification.
2. Failure path: receiver returns 500 → retries with backoff timestamps advancing; after max, dead-lettered with lastError; redeliver endpoint → successful delivery → marked delivered.
3. Two deliverer instances against one outbox: no double-delivery of a single (event, webhook) attempt (SKIP LOCKED test).
4. Crash-safety: kill between send and `markDelivered` → event redelivered on next pass (documents the at-least-once contract).
5. Fan-out: two webhooks on one form, one failing - states independent.

## Out of scope

Webhook config CRUD (024), admin UI (035), consumer-side idempotency (documented only).
