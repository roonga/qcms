# Secure links — token format (task 010)

**Source of truth for the wire format** of qcms compact tokens and the secure-link
purpose built on them. Implementation: `packages/core/src/compact-token.ts` and
`packages/core/src/secure-link.ts` (`@qcms/core`). Design authority:
`SECURITY_DESIGN.md` §2.2 (SEC-2) and §4 (SEC-7), `ARCHITECTURE.md` §7.

## Compact tokens

A qcms **compact token** is a minimal signed-claims string:

```
base64url( canonicalJson( claims ∪ { purpose } ) ) "." base64url( HMAC-SHA256 signature )
```

- **Two segments**, separated by a single `.` — payload, then signature. There is
  no header segment: the algorithm is fixed (HMAC-SHA256), so nothing is
  negotiable and there is no `alg`/`none` attack surface. This is deliberately a
  hand-rolled JWT-like shape, not a JWT library — mainstream JWT libraries pull
  Node-only dependencies (`node:crypto`, `Buffer`), which would break the
  kernel's fetch-purity (R4), and ship algorithm agility the SEC-7 inventory
  forbids.
- **Payload** = the claims object plus a reserved `purpose` claim, serialized
  with the package-wide canonical JSON (sorted keys — signing is deterministic
  regardless of claim order), UTF-8 encoded, base64url (unpadded).
- **Signature** = HMAC-SHA256 over the UTF-8 bytes of the *encoded payload
  segment*, base64url (unpadded). Computed and verified with WebCrypto
  (`crypto.subtle`) only — runs identically in Node and edge runtimes.
  Verification uses `crypto.subtle.verify`, which compares in constant time;
  digest bytes are never compared manually.

### Purposes (SEC-7)

Every token carries a `purpose` claim inside the signed payload:

| Purpose | Token | Claims | Keys env | Task |
|---|---|---|---|---|
| `link` | Secure link | `{ formId, linkId, expiresAt, oneTime? }` | `QCMS_LINK_KEYS` | 010 |
| `session` | Respondent session | `{ sessionId }` | `QCMS_SESSION_KEYS` | 018 |

Each purpose has its **own key list**; verification also demands an exact
purpose match (`WRONG_PURPOSE` otherwise). The two controls hold independently:
even if an operator reuses one key for both purposes, a session token can never
pass link verification or vice versa.

### Standard claims

- `purpose` *(required, machinery-written)* — one of the purposes above.
  Callers never set it; `signCompactToken` throws if claims carry one.
- `expiresAt` *(optional at the generic layer; required for links)* — ISO 8601
  UTC datetime. A token is valid strictly **before** `expiresAt`; at or after
  it, verification fails `EXPIRED`.

## Secure links (`purpose: "link"`, SEC-2)

Claims (Zod schema `LinkClaims` is the source of truth):

| Claim | Type | Meaning |
|---|---|---|
| `formId` | `frm_…` branded ID | The single form this link opens |
| `linkId` | `lnk_…` branded ID | The minted-link row, so storage can revoke and enforce one-time use (013/018) |
| `expiresAt` | ISO 8601 UTC datetime | Hard expiry; valid strictly before this instant |
| `oneTime` | boolean, optional | Single-use marker; carried for the verifier, *enforced* by the `secure_links` row |

API (`@qcms/core`):

- `mintSecureLink(payload, key)` → token string. Key = the **first** entry of
  the deployment's link-key list.
- `verifySecureLink(token, keys, now, expectedFormId?)` → `Result<LinkClaims,
  LinkError>` with typed failures, checked in order: `MALFORMED` (not two
  base64url segments / not JSON / not valid claims) → `BAD_SIGNATURE` (no key
  verifies) → `WRONG_PURPOSE` (cross-purpose token) → `EXPIRED` →
  `WRONG_FORM` (only when `expectedFormId` is passed).

A verified signature is **never sufficient on its own**: the API must also
consult the `secure_links` row for revocation and atomic one-time consumption
(018). Verifying a link mints a session; from then on the session token is the
credential (SEC-2).

Secure links are the sole, deliberate case of a token appearing in a URL
(SEC-8), mitigated by expiry plus that server-side row.

## Key material and rotation (SEC-7)

Keys are supplied by the shell from `QCMS_LINK_KEYS` (task 024) — the kernel
only consumes `CryptoKey`s, imported via `importCompactTokenKey` (raw bytes →
non-extractable HMAC-SHA256 key; minimum **32 bytes**, generate with
`openssl rand -base64 32`).

Rotation model — *first entry signs, all entries verify, tried newest first*:

1. Generate a new key and **prepend** it to the key list; restart/redeploy.
   New links are now signed with the new key; outstanding links still verify
   against the old key further down the list.
2. Keep the old key listed until every token signed with it has passed its
   expiry (for links: the longest `expiresAt` you minted).
3. Drop the old key from the list. Anything still signed with it now fails
   `BAD_SIGNATURE` — which is the point.

Compromise response is the same procedure without step 2's grace: drop the
compromised key immediately and accept that outstanding links die; re-mint.

## Non-goals (explicit)

- **No PII in tokens, ever** (SEC-2). Claims are opaque branded IDs and an
  expiry — never names, emails, answers, or anything derived from respondent
  data. The payload segment is *encoded, not encrypted*: anyone holding a link
  can decode and read its claims.
- **No revocation by signature.** Revocation, one-time consumption, and usage
  accounting live in storage (`secure_links`, tasks 013/018), not in the token.
- **No key generation or storage in the kernel** — the shell owns key material
  (task 024); rotation runbooks land in `docs/operations.md` (036).
- **No algorithm agility.** HMAC-SHA256 only; there is no header and no `alg`
  claim, and there never will be one short of a superseding SEC decision.
- **No OTP/social respondent identity** — Phase 4, behind the same seam.
