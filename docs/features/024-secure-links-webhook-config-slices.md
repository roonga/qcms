# 024 - Secure-link minting and webhook config slices

**Stage:** 6 · **App:** `apps/api` (`features/links/*`, `features/webhooks/configure`, `/admin` group) · **Depends on:** 018, 017
**References:** `ARCHITECTURE.md` §7 · ADR-06 · review resolution "secure-link minting has no home"

## Context

The authoring-side halves of two respondent-facing features: authors mint the links respondents open (verified in 018), and configure the webhook endpoints the deliverer (025) targets. Key material comes from validated config (017); core does the cryptography (010).

## Deliverables

**Secure links** (`/admin`):

- `POST /admin/forms/:id/links` - body `{ expiresAt, oneTime, count? }` (count ≤ documented cap, default 1, for batch generation): insert `secure_links` rows, mint tokens via 010 with the current signing key, return `[{ linkId, url, expiresAt }]` - URL built from configured portal base URL.
- `GET /admin/forms/:id/links` - list with state (active / consumed / expired / revoked), consumption timestamps.
- `POST /admin/links/:linkId/revoke` - sets revokedAt; 018 rejects thereafter.
- Key rotation supported operationally: config takes a key list (newest signs, all verify - 010); document the rotation runbook in `docs/secure-links.md`.

**Webhook configuration** (`/admin`):

- `POST /admin/forms/:id/webhooks` - `{ url (https required outside dev), secret?, active }`; secret generated if omitted, shown once on creation, stored hashed-equivalent or encrypted at rest (document choice; it must be *usable* for signing in 025, so at-rest encryption with the app key, not a one-way hash).
- `GET /admin/forms/:id/webhooks` (secrets masked) · `PUT .../:webhookId` (rotate secret explicitly; new secret shown once) · `DELETE` (soft-deactivate).
- Multiple webhooks per form allowed; 025 delivers to each active one.
- SSRF guardrail: reject URLs resolving to private/reserved ranges by default, with an explicit config override for on-prem targets (documented - enterprise topology legitimately posts to internal systems).
- Annotate every route with its intended `/api/v1` scope in route metadata (SEC-5: `links:mint` for link endpoints, `webhooks:manage` for webhook config) - inert at launch; exists so Phase-4 activation is wiring, not archaeology.

## Exit criteria

1. Mint → verify loop: minted URL's token passes 018's start-session; revoked link rejected; batch mint respects cap.
2. Rotation test: links minted under old key still verify after rotation config change.
3. Webhook CRUD tests; secret shown exactly once; masked thereafter; SSRF cases (localhost, 10.x, link-local) rejected by default and allowed under override flag.
4. Config schema (017) extended and validated for portal base URL and key list.

## Out of scope

Delivery (025), admin UIs (034/035), OTP/social (Phase 4).
