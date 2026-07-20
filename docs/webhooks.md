# Webhooks - configuration (task 024) and delivery (task 025)

Per-form webhook endpoints qcms POSTs a signed `response.submitted` event to on
submission. Design authority: `SECURITY_DESIGN.md` §2.5 (SEC-6) and §4 (SEC-7);
`ARCHITECTURE.md` §5.3 (the in-process outbox deliverer) and §11 (egress
reliability). **Configuration** - the admin CRUD and at-rest secret encryption -
is task 024; **delivery** - the background pass that signs, sends, retries, and
dead-letters - is task 025, documented from ["Delivery"](#delivery-task-025) down.

## Admin surface

All routes carry the `webhooks:manage` SEC-5 scope (inert at launch) and sit
behind the internal service-token gate (SEC-4) and admin-auth. A public-only
process has no admin group, so these paths 404 (ADR-09).

| Route | Effect |
|---|---|
| `POST /admin/forms/:id/webhooks` | `{ url, secret?, active? }` → configure a webhook. The secret is **generated** if omitted, and shown **exactly once** in the response `secret` field. |
| `GET /admin/forms/:id/webhooks` | List the form's webhooks. Secrets are **masked** - never returned; each row reports `hasSecret: true`. |
| `PUT /admin/forms/:id/webhooks/:webhookId` | Update `url` / `active`, or rotate the secret. Rotation is explicit (`rotateSecret: true` or an explicit `secret`) and the new secret is shown once; a plain update never re-reveals it. |
| `DELETE /admin/forms/:id/webhooks/:webhookId` | **Soft-deactivate**: sets `active = false`, stamps `deactivated_at`; the row is retained so delivery history survives. |

Multiple webhooks per form are allowed; 025 delivers to every `active` one.

## Secret storage - encrypted at rest, not hashed (SEC-6/SEC-8)

The per-webhook secret is the HMAC key 025 uses to sign each delivery
(`X-QCMS-Signature: v1=HMAC-SHA256(secret, timestamp + "." + body)`). Signing
needs the **plaintext**, so the secret must be *recoverable* - it is
**encrypted at rest, never hashed** (a one-way hash would make signing
impossible).

- **Algorithm:** AES-256-GCM via WebCrypto (`crypto.subtle`) only - R4
  fetch-pure, no `node:crypto`. Implementation:
  `apps/api/src/features/webhooks/crypto.ts`.
- **Key:** derived from `QCMS_APP_KEY` (validated ≥32 chars at boot) by SHA-256
  → a stable 32-byte AES key. `QCMS_APP_KEY` is high-entropy random material
  (SEC-7), so a single-key derivation without per-secret salt is sufficient;
  AES-GCM's per-encryption random 12-byte IV already guarantees distinct
  ciphertexts for identical plaintexts.
- **Stored form:** `secret_encrypted = "v1." + base64(iv ‖ ciphertext ‖ tag)`.
  The `v1.` prefix leaves room for a future scheme without a data migration. The
  database only ever sees opaque ciphertext; the plaintext is never persisted
  and never logged (SEC-8). The 024 round-trip test proves
  `decrypt(secret_encrypted) === the-shown-secret`, which is exactly what 025
  relies on.
- **Rotation:** `PUT` with `rotateSecret` re-encrypts a fresh secret and
  re-reveals it once. SEC-6's dual-signing overlap window (old+new both signed
  during rotation) is a **025 delivery-time** concern, not stored here.

## SSRF guardrail (SEC-6)

Webhook target URLs are validated **at config time** on the literal URL
(`apps/api/src/features/webhooks/ssrf.ts`) - no DNS resolution (a Node concern;
full DNS-rebinding protection is delivery-time, 025). By **default** the policy
is deny:

- scheme must be **https** (plain http rejected);
- host must not be `localhost` / `*.localhost`, nor an IP literal in a
  private/reserved/loopback/link-local range - `127.0.0.0/8`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local, incl. the
  cloud metadata endpoint `169.254.169.254`), `100.64.0.0/10` (CGNAT),
  `0.0.0.0/8`, multicast/reserved `≥224.0.0.0`, and the IPv6 equivalents `::1`,
  `::`, `fc00::/7` (ULA), `fe80::/10` (link-local), and IPv4-mapped forms.

A rejected URL returns `422 WEBHOOK_URL_REJECTED` with a `reason` in `details`.

### On-prem override

Set **`QCMS_WEBHOOK_ALLOW_PRIVATE=true`** to permit private/reserved hosts and
plain http - for enterprise topologies that legitimately post to internal
systems. It is `false` by default; non-http(s) schemes are rejected even under
the override. This is the single documented escape hatch for SSRF.

## Delivery (task 025)

The submission transaction writes a `response.submitted` event to the
transactional outbox (020); an **in-process background pass** (no fifth container,
`ARCHITECTURE.md` §5.3) drains it and delivers to every active webhook. Runs in
the internal API process only, on the 017 scheduler. **At-least-once, never
best-effort.** Implementation: `apps/api/src/schedulers/outbox-delivery.ts`.

### Two phases, each `FOR UPDATE SKIP LOCKED` (multi-instance safe)

1. **Materialize.** Claim a due outbox event and fan it out to one
   `webhook_deliveries` row per *active* webhook (idempotent via the `(outbox_id,
   webhook_id)` unique key), then mark the event consumed. The outbox is the
   fan-out source; each delivery row is an independent delivery with its **own**
   retry/backoff/dead-letter state - so one webhook failing never stalls another.
2. **Deliver.** Claim a due delivery row in its own transaction (which holds the
   row lock across the POST), sign and send, then record the outcome and commit.

`SKIP LOCKED` means several API instances polling the same table never claim the
same delivery. Holding the lock across the POST is also what makes it crash-safe:
a crash between send and commit rolls back to a redeliverable state.

### The request

`POST` to the configured URL with a JSON body: the 020 event payload wrapped in a
small envelope.

```jsonc
{
  "eventId":     "a1b2c3d4-…",          // the outbox event id (idempotency key)
  "eventType":   "response.submitted",
  "deliveredAt": "2026-07-20T02:05:00.000Z",
  "payload": {                           // 020's response.submitted payload
    "sessionId": "ses_…",
    "formId": "frm_…",
    "formVersion": 3,
    "submittedAt": "2026-07-20T02:04:59.000Z",
    "contentHash": "…",                 // idempotency key (stable per submission)
    "answers": { "q_name": "Ada" }
  }
}
```

Headers:

| Header | Value |
|---|---|
| `X-QCMS-Event` | the event type (`response.submitted`) |
| `X-QCMS-Delivery` | a fresh UUID, **unique per attempt** (a retry has a new one) |
| `X-QCMS-Timestamp` | Unix seconds when the request was signed |
| `X-QCMS-Signature` | `v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>` |

The signature covers `` `${timestamp}.${body}` `` - the exact `X-QCMS-Timestamp`
and the raw body bytes. Because the timestamp is signed, a consumer that also
checks its freshness gets **replay protection**: a captured request replayed
outside the acceptance window fails the timestamp check, and it cannot be
re-timestamped without invalidating the signature. Signing is **WebCrypto only**
(`crypto.subtle` HMAC-SHA256, R4 - never `node:crypto`); the plaintext secret is
recovered from its at-rest ciphertext (024) only in memory, only to sign, and is
never logged (SEC-8).

### Success, retries, dead-letter

A delivery **succeeds** on any `2xx` within the timeout
(`QCMS_WEBHOOK_TIMEOUT_MS`, default 10 s). Anything else - non-2xx, timeout,
network error, or a delivery-time SSRF rejection - is a failed attempt: the
delivery is rescheduled with capped exponential backoff (shared with the outbox:
1 m → 5 m → 25 m → … capped at 6 h) and, after 10 failed attempts, **dead-lettered**
(`dead_lettered_at` set, `last_error` recorded) and surfaced for manual
redelivery. `last_error` is a value-free code (`http_500`, `timeout`,
`network_error`, `ssrf_rejected:<reason>`, `secret_decrypt_failed`) - never a
secret or answer value.

Per-pass counts (`materialized`, `claimed`, `delivered`, `failed`,
`deadLettered`) are logged as structured fields for observability; ids and counts
only, never payloads (SEC-8).

### At-least-once - consumers must be idempotent

Delivery is at-least-once, so a consumer **can** receive a duplicate - from a
crash after send but before commit, or from a manual redelivery. Consumers must
de-duplicate: **`eventId`** (stable per outbox event) and **`contentHash`**
(stable per submission) are the idempotency keys. Processing the same `eventId`
twice must be a no-op. (Consumer-side idempotency is the consumer's
responsibility; qcms documents it but does not implement it.)

### SSRF at delivery time (defense-in-depth)

The target URL is re-checked against the SSRF policy (same rules and
`QCMS_WEBHOOK_ALLOW_PRIVATE` override as config time) immediately before every
POST. This is **defense-in-depth on the literal URL** and does **not** fully close
DNS rebinding - a hostname that passed can resolve to a private address at fetch
time. Fully closing it requires resolving the host and pinning the delivery
socket to the vetted IP, which is out of scope for launch; the config-time check,
the delivery-time re-check, and the `QCMS_WEBHOOK_ALLOW_PRIVATE=false` default are
the shipped controls.

## Verifying a delivery - consumer recipe

Recompute the HMAC over `` `${X-QCMS-Timestamp}.${rawBody}` `` with your webhook
secret and compare (constant-time) to the hex after `v1=`. Verify against the
**raw request bytes**, before any JSON re-serialization. Reject if the timestamp
is too old (e.g. > 5 minutes) to bound replay.

**Node**

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, headers, rawBody) {
  const ts = headers["x-qcms-timestamp"];
  const sig = headers["x-qcms-signature"]; // "v1=<hex>"
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay window
  const expected = "v1=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

**.NET**

```csharp
using System.Security.Cryptography;
using System.Text;

static bool Verify(string secret, string timestamp, string signature, string rawBody)
{
    if (Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - long.Parse(timestamp)) > 300)
        return false; // replay window
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var mac = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{rawBody}"));
    var expected = "v1=" + Convert.ToHexString(mac).ToLowerInvariant();
    return CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(signature), Encoding.UTF8.GetBytes(expected));
}
```

## Operations - dead-letters and redelivery (task 025)

Delivery failures are visible and recoverable through the admin surface (035
renders this). Both routes carry the `webhooks:manage` SEC-5 scope - the launch
taxonomy has no dedicated operations scope, so delivery-ops reuse the same
authority that configures the webhooks (a `webhooks:operate` split is Phase 4).
They sit behind the internal service-token gate (SEC-4) and admin-auth; a
public-only process has no admin group, so they 404 (ADR-09).

| Route | Effect |
|---|---|
| `GET /admin/outbox/dead-letters` | List dead-lettered deliveries newest-first, each with its `eventId`, `eventType`, `webhookId`, `url`, `attempts`, and `lastError` (attempt history). |
| `POST /admin/outbox/:id/redeliver` | Reset one dead-lettered **delivery** (`:id` is a delivery id) to due-now - clears the dead-letter flag, resets attempts, and the next pass re-attempts it. `404` if unknown. |

A dead-letter is a single `(event, webhook)` delivery, not the whole event:
redelivering one webhook does not touch its siblings for the same event.

## Config (task 017, extended by 024/025)

| Env var | Meaning |
|---|---|
| `QCMS_APP_KEY` | AES-256-GCM key material for at-rest secret encryption (≥32 chars). |
| `QCMS_PORTAL_BASE_URL` | Absolute http(s) portal base URL (used for secure-link URLs). |
| `QCMS_WEBHOOK_ALLOW_PRIVATE` | SSRF override (default `false`); applied at config **and** delivery time. |
| `QCMS_WEBHOOK_TIMEOUT_MS` | Per-delivery request timeout in ms (default `10000`). |
| `QCMS_WEBHOOK_BATCH_SIZE` | Max deliveries processed per pass (default `20`). |
| `QCMS_OUTBOX_INTERVAL_MS` / `QCMS_OUTBOX_JITTER_MS` | Deliverer poll interval and per-tick jitter (017). |
