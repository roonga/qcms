# 010 - Secure-link tokens (core)

**Stage:** 3 · **Package:** `@qcms/core` · **Depends on:** 002
**References:** `ARCHITECTURE.md` §7 · ADR-06 · `SECURITY_DESIGN.md` §2.2 (SEC-2), §4 (SEC-7) · review resolution "secure-link minting has no home"

## Context

Secure links gate response integrity, so mint/verify live in the core as pure functions over supplied key material. Key storage, rotation, and distribution are shell/API concerns (024, 034). This closes the gap where HLA said "in the core" but no stage built it. The token machinery is **purpose-tagged and generic** (SEC-2/SEC-7): secure links are its first purpose here; respondent session tokens (018) are its second - distinct keys per purpose, cross-purpose use rejected.

## Deliverables

- Generic compact-token machinery: `signCompactToken(purpose, claims, key)` / `verifyCompactToken(purpose, token, keys, now)` - HMAC-SHA256 over a canonical serialization that includes a **`purpose` claim** (SEC-7: distinct keys per purpose; verification rejects a purpose mismatch with `WRONG_PURPOSE`), base64url encoded. Multiple keys accepted for rotation (SEC-7 model: first entry signs, all verify - try newest first). Implement with WebCrypto (`crypto.subtle`) only - fetch-pure (R4), works in Node and edge. (A signed compact token ≈ a JWT; hand-roll the minimal shape rather than pulling a JWT library with Node-only deps - document why.)
- Secure links as the first purpose (`purpose: "link"`): claims `{ formId, linkId, expiresAt, oneTime?: boolean }`.
- `mintSecureLink(payload, key: CryptoKey): Promise<string>`
- `verifySecureLink(token, keys: CryptoKey[], now: Date): Promise<Result<LinkClaims, LinkError>>` - typed errors: `MALFORMED`, `BAD_SIGNATURE`, `WRONG_PURPOSE`, `EXPIRED`, `WRONG_FORM` (when caller passes an expected formId). (018 adds `purpose: "session"` with claims `{ sessionId }` on the same machinery, keys from `QCMS_SESSION_KEYS` - SEC-2.)
- `linkId` (`lnk_` branded ID) so one-time-use and revocation can be enforced by storage later (013/018) - core defines the claim, storage enforces consumption.
- Constant-time signature comparison (WebCrypto verify handles this - do not compare digests manually).

## Exit criteria

1. Round-trip mint→verify passes; each error path has a test (tampered payload, tampered signature, expired, wrong form, garbage input).
2. Rotation test: token minted with key A verifies against `[B, A]`.
2a. Cross-purpose rejection: a token minted with `purpose: "session"` fails secure-link verification with `WRONG_PURPOSE` (and vice versa), even when signed with the same key (SEC-7).
3. No Node-specific imports (`node:crypto` forbidden); lint rule or import test enforces it.
4. Token format documented (`docs/secure-links.md`): claims, encoding, rotation procedure, explicit non-goals (no PII in tokens).

## Out of scope

Key generation/storage (024 supplies keys from env), one-time consumption (018), admin minting UI (034), OTP/social (Phase 4).
