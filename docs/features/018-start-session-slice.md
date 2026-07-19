# 018 — start-session slice

**Stage:** 6 · **App:** `apps/api` (`features/responses/start-session`) · **Depends on:** 017, 010, 014
**References:** `ARCHITECTURE.md` §5.2, §7 · ADR-06, ADR-07 · I4 · R5

## Context

The respondent's front door. Anonymous or secure-link entry; the session pins the newest published form version at creation and never migrates (I4 — structural, because no migration path exists).

## Deliverables

- `POST /sessions` — body `{ formSlug }` (anonymous) or `{ token }` (secure link):
  - **Anonymous:** form exists, is open, has ≥1 published version → create session pinned to newest published version, accessMode `anonymous`, TTL from config.
  - **Secure link:** `verifySecureLink` (010) against configured keys → check `secure_links` state (not revoked; if one-time, atomically consume via `consumeSecureLink`) → create session pinned to the *link's* form's newest published version, accessMode `secure_link`, expiry = min(link expiry, session TTL).
  - Response: `{ sessionId, sessionToken, formVersion, expiresAt }`. **Session token**: signed token binding `sessionId` (010's purpose-tagged machinery: `purpose: "session"`, claims `{ sessionId }`, keys from `QCMS_SESSION_KEYS` — SEC-2); all later respondent calls require it (abuse: session-token binding, hardened further in 026).
  - Typed failures: `FORM_NOT_FOUND`, `FORM_CLOSED`, `NO_PUBLISHED_VERSION`, `LINK_INVALID`, `LINK_EXPIRED`, `LINK_CONSUMED`, `LINK_REVOKED` — the envelope distinguishes what the portal may show respondents (link errors get friendly pages, 029).
- `GET /sessions/:id` (session-token authed) — status, formVersion, expiresAt, current flow position (for resume; flow computed as in 019).
- Transaction ownership per slice; this is a transaction script (R5) — no kernel call needed except token verify.

## Exit criteria

1. Slice tests via `app.request()`: anonymous happy path; each typed failure; one-time link race (two concurrent starts, one wins) against the real harness DB.
2. Pinning test: publish v2 after session creation → session still serves v1.
3. Session token: calls without/with-tampered token → 401.
4. Newest-version selection test with three published versions.

## Out of scope

Step serving (019), minting links (024), rate limiting numbers (026), portal pages (029).
