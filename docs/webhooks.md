# Webhook configuration (task 024)

Authoring-side configuration of the webhook endpoints the deliverer (025)
targets. Design authority: `SECURITY_DESIGN.md` §2.5 (SEC-6) and §4 (SEC-7).
Delivery, signing, and retries are **025** — this task only stores the config.

## Admin surface

All routes carry the `webhooks:manage` SEC-5 scope (inert at launch) and sit
behind the internal service-token gate (SEC-4) and admin-auth. A public-only
process has no admin group, so these paths 404 (ADR-09).

| Route | Effect |
|---|---|
| `POST /admin/forms/:id/webhooks` | `{ url, secret?, active? }` → configure a webhook. The secret is **generated** if omitted, and shown **exactly once** in the response `secret` field. |
| `GET /admin/forms/:id/webhooks` | List the form's webhooks. Secrets are **masked** — never returned; each row reports `hasSecret: true`. |
| `PUT /admin/forms/:id/webhooks/:webhookId` | Update `url` / `active`, or rotate the secret. Rotation is explicit (`rotateSecret: true` or an explicit `secret`) and the new secret is shown once; a plain update never re-reveals it. |
| `DELETE /admin/forms/:id/webhooks/:webhookId` | **Soft-deactivate**: sets `active = false`, stamps `deactivated_at`; the row is retained so delivery history survives. |

Multiple webhooks per form are allowed; 025 delivers to every `active` one.

## Secret storage — encrypted at rest, not hashed (SEC-6/SEC-8)

The per-webhook secret is the HMAC key 025 uses to sign each delivery
(`X-QCMS-Signature: v1=HMAC-SHA256(secret, timestamp + "." + body)`). Signing
needs the **plaintext**, so the secret must be *recoverable* — it is
**encrypted at rest, never hashed** (a one-way hash would make signing
impossible).

- **Algorithm:** AES-256-GCM via WebCrypto (`crypto.subtle`) only — R4
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
(`apps/api/src/features/webhooks/ssrf.ts`) — no DNS resolution (a Node concern;
full DNS-rebinding protection is delivery-time, 025). By **default** the policy
is deny:

- scheme must be **https** (plain http rejected);
- host must not be `localhost` / `*.localhost`, nor an IP literal in a
  private/reserved/loopback/link-local range — `127.0.0.0/8`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local, incl. the
  cloud metadata endpoint `169.254.169.254`), `100.64.0.0/10` (CGNAT),
  `0.0.0.0/8`, multicast/reserved `≥224.0.0.0`, and the IPv6 equivalents `::1`,
  `::`, `fc00::/7` (ULA), `fe80::/10` (link-local), and IPv4-mapped forms.

A rejected URL returns `422 WEBHOOK_URL_REJECTED` with a `reason` in `details`.

### On-prem override

Set **`QCMS_WEBHOOK_ALLOW_PRIVATE=true`** to permit private/reserved hosts and
plain http — for enterprise topologies that legitimately post to internal
systems. It is `false` by default; non-http(s) schemes are rejected even under
the override. This is the single documented escape hatch for SSRF.

## Config (task 017, extended by 024)

| Env var | Meaning |
|---|---|
| `QCMS_APP_KEY` | AES-256-GCM key material for at-rest secret encryption (≥32 chars). |
| `QCMS_PORTAL_BASE_URL` | Absolute http(s) portal base URL (used for secure-link URLs). |
| `QCMS_WEBHOOK_ALLOW_PRIVATE` | SSRF override (default `false`). |
