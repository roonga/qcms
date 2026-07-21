# QCMS - Security Design

**Status:** v1.1 (formal) · companion to `ARCHITECTURE.md` (§5.1, §7, §8) and `PROJECT_GOAL.md` (ADR-16…25) · v1.1: ingress language per ADR-20; task-file fold-back note (§10)
**Decisions here are numbered SEC-1…SEC-12** and carry ADR weight; conflicts are flagged, not silently overridden.
**Delivery:** every control in this document maps to a task in `features/` (traceability matrix, §10). New task: `features/040-security-review-hardening.md`, executed after 036 and before the launch gate (038).

---

## 1. Principles and threat model

**Principles.** Least privilege per surface; network isolation as a build-time guarantee, with in-band auth as defense-in-depth (never the reverse); every token bound to the narrowest possible thing (one session, one form, one purpose); secrets validated at boot and rotatable without downtime; the audit properties (immutability, append-only ledger) are themselves security controls - protect them.

**Assets, most valuable first:** respondent answers (PII by assumption); admin credentials and sessions (can read all responses, publish forms); webhook secrets (forgeable submissions downstream if leaked); secure-link and session signing keys (session/response forgery); published-snapshot integrity (the audit promise); availability of the public portal.

**Actors:** anonymous internet users (portal is public); respondents with links; form authors (trusted, authenticated, 2FA); deployment operators (fully trusted, own the box); downstream webhook consumers (semi-trusted - they receive data, never send); bots/scrapers/spammers (the common adversary); a targeted attacker after response data (the serious adversary).

**Trust boundaries:**

```
internet ──[B1]──▶ operator ingress (TLS) ──▶ portal (SSR+BFF) ──[B2]──▶ api (public mounts) ──[B3]──▶ postgres
vpn ──────[B4]──▶ admin (BFF) ─────────────────[B2]──▶ api (admin mounts)  ──[B3]──▶ postgres
api ──[B5: egress]──▶ webhook consumers
```

- **B1** internet→portal: TLS terminates at the operator's ingress (ADR-20: cloud LB, or the optional Caddy overlay); everything hostile arrives here. Ingress routes only portal and admin - the API container publishes no port.
- **B2** BFF→API: internal network; authenticated in-band anyway (SEC-4).
- **B3** API→Postgres: credentialed, private network, least-privilege DB roles (SEC-10).
- **B4** operator/author→admin: VPN in enterprise; TLS + auth in solo.
- **B5** API→consumers: outbound only; signed (SEC-6); SSRF-guarded (024).

**Out of scope of the software (documented operator responsibility):** host/OS hardening, VPN configuration, ingress/TLS provisioning (ADR-20; recipes in 036), Postgres server hardening, DDoS absorption (ingress/CDN concern), physical security, backup media custody.

## 2. Authentication

### 2.1 Admin users (authors/operators) - SEC-1

better-auth in-process (ADR-06), email + password with **TOTP 2FA enforced by default** (`QCMS_ADMIN_2FA=optional` dev escape hatch), recovery codes generated at enrollment (shown once, stored hashed). Password policy: zxcvbn-style strength check (min score, not composition rules); passwords hashed by better-auth's default (argon2id or scrypt - verify and pin). Session: httpOnly, `SameSite=Lax`, `Secure` cookies; absolute lifetime 12h, idle timeout 1h (configurable); server-side session invalidation on sign-out and password change. Sign-in throttling: per-account and per-IP exponential backoff; generic failure messages (no user enumeration - same response for unknown email and wrong password). First admin via `qcms:create-admin` CLI only; **no self-registration path exists in any composition**. Delivered: 031.

### 2.2 Respondents - SEC-2

Launch modes only (OTP/social are Phase 4 behind the same seam):

- **Anonymous:** `POST /sessions` issues a **session token** - HMAC-signed compact token (010 machinery) with claims `{ sessionId, purpose: "session" }`, held by the portal BFF in an httpOnly `SameSite=Lax` `Secure` cookie, path-scoped, lifetime = session TTL. The token authorizes exactly one session and nothing else. Client JS never sees it (R2 - the BFF attaches it as a bearer header on internal calls).
- **Secure links:** signed, expiring, single-form tokens (010): claims `{ formId, linkId, expiresAt, oneTime? }`, HMAC-SHA256, base64url; server-side state (`secure_links`) adds revocation and atomic one-time consumption - *a signature alone is never sufficient; the row must agree*. No PII in tokens, ever. Verifying a link mints a session; from then on the session token is the credential.

Distinct signing keys per purpose (session vs link - SEC-7); purpose claim checked on verify so tokens cannot be cross-used. Delivered: 010, 018, 024.

### 2.3 Service-to-service (BFF → API) - SEC-4

Primary control is topology: public API processes mount only respondent groups (ADR-09); admin groups don't exist there. Defense-in-depth in-band: both BFFs attach a deployment-scoped **internal service token** (`QCMS_INTERNAL_TOKEN`, ≥32 random bytes, from config) on every call to the API; the API rejects internal-surface requests without it. This is deliberately a static shared secret, not mTLS or a token service - the solo operability budget rules those out; the enterprise recipe documents upgrading to mTLS at the mesh/proxy layer as an operator choice. End-user authorization always comes from the *user's* credential (admin session or session token) forwarded by the BFF - the service token authenticates the *channel*, never the user. Delivered: 017 (middleware + config), 029/031 (BFF attachment).

### 2.4 Machine consumers (`/api/v1`) - SEC-5, reserved

De-scoped at launch (ADR-10), **designed now** so the seam is real:

- **Credential:** opaque personal-access-style tokens, prefix `qcms_pat_`, ≥32 random bytes; stored **hashed** (SHA-256) - displayable once at creation; per-token expiry (max 1 year, default 90 days), last-used tracking, revocation.
- **Scopes** (granted per token, checked per route; the taxonomy is fixed now so route annotations exist from day one):

| Scope | Grants |
|---|---|
| `forms:read` | Read forms, versions, published snapshots |
| `forms:write` | Draft CRUD, publish |
| `questions:read` / `questions:write` | Library read / library authoring |
| `responses:read` | List and read submissions |
| `responses:write` | Respondent write endpoints: start a session (`POST /sessions`), submit an answer (`POST /sessions/{id}/answers`). Does not imply `responses:read` (grant both explicitly) |
| `responses:export` | Bulk export endpoints |
| `responses:erase` | Erasure (never bundled into broad grants; must be explicit) |
| `links:mint` | Mint/revoke secure links |
| `webhooks:manage` | Webhook config |

- Rules: scopes are additive, no implicit hierarchies; `*:write` does not imply `*:read` is *granted* implicitly (grant both explicitly - dumb and auditable); erase is never part of any preset. Per-token rate limits. OpenAPI security scheme generated with the routes (`@hono/zod-openapi`). Delivered: Phase 4 (039 item 3) - but 021–024 slice authors annotate intended scopes in route metadata as they build, so activation is wiring, not archaeology. Scope annotations ride in the `@hono/zod-openapi` route definitions (017's convention) and surface in the generated internal OpenAPI documents (027).

### 2.5 Webhook egress - SEC-6

Consumers authenticate *us*: `X-QCMS-Signature: v1=HMAC-SHA256(secret, timestamp + "." + body)` with `X-QCMS-Timestamp`; consumers reject skew > 5 min (replay bound) and verify constant-time. Per-webhook secrets, generated server-side, shown once, encrypted at rest (SEC-8), rotatable with overlap (old+new both signed during a documented window - implement as dual-signature headers during rotation). Delivered: 024, 025.

## 3. Authorization

### 3.1 Launch model - SEC-3

One human role: **admin** (full authoring surface). The session context carries a `role` claim from day one so RBAC is additive (Phase 4 sketch: `admin` / `author` (no webhook config, no erasure) / `viewer` (responses read-only) - recorded as an issue, not built, R7). Authorization is enforced **in the API layer** (middleware per route group + per-route checks), never in the BFF (R2) and never only in the UI.

Respondent authorization is structural: a session token authorizes exactly `{read step, answer, submit}` on its one session; there is no respondent-facing list/enumerate anything. Session IDs are non-sequential (branded random ids) - but possession of an ID grants nothing without the signed token.

### 3.2 Authorization matrix (launch)

| Action | Anonymous | Session-token holder | Admin (2FA session) | Internal service token alone |
|---|---|---|---|---|
| Start anonymous session | ✔ (rate-limited) | - | ✔ | ✖ |
| Redeem secure link | ✔ with valid token | - | - | ✖ |
| Get step / answer / submit | ✖ | ✔ own session only | ✖ (admins use preview) | ✖ |
| Question/form authoring, publish | ✖ | ✖ | ✔ | ✖ |
| Responses read/export | ✖ | ✖ | ✔ | ✖ |
| Erasure | ✖ | ✖ | ✔ (confirmed UI / explicit scope later) | ✖ |
| Links mint/revoke, webhook config | ✖ | ✖ | ✔ | ✖ |
| Health/ready | ✔ | ✔ | ✔ | ✔ |

The service token authorizes no action by itself - it only opens the channel (SEC-4). Enforcement tests for this matrix are part of 040.

## 4. Token and key inventory - SEC-7

| Credential | Format | Lifetime | Stored | Rotation |
|---|---|---|---|---|
| Admin password | argon2id/scrypt hash | until changed | hashed (better-auth) | user-driven; sessions invalidated |
| Admin session | better-auth cookie | 12h abs / 1h idle | server-side session | sign-out, password change |
| TOTP secret / recovery codes | per better-auth | until re-enrolled | encrypted / hashed | re-enrollment |
| Respondent session token | HMAC compact (010) | session TTL | not stored (stateless + session row) | key: `QCMS_SESSION_KEYS` list |
| Secure link | HMAC compact (010) | link expiry | state row (`secure_links`) | key: `QCMS_LINK_KEYS` list |
| Internal service token | random ≥32B | until rotated | config only | overlap via accepted-list |
| Webhook secret | random ≥32B | until rotated | **encrypted at rest** (SEC-8) | dual-signing window |
| `/api/v1` PAT *(reserved)* | `qcms_pat_` random | ≤ 90d default | hashed | revoke + reissue |
| App encryption key | `QCMS_APP_KEY` (32B) | until rotated | config only | re-encrypt job, documented |
| LLM provider key *(flag-gated, ADR-25)* | `QCMS_AGENT_API_KEY` | until rotated | config only; required iff `QCMS_FLAG_AGENT_AUTHORING` ≠ `none` | rotate at provider + config |

All key-list envs accept multiple keys: first entry signs, all verify (010's rotation model generalized). Rotation runbooks live in `docs/operations.md` (036).

## 5. Transport and browser security - SEC-9

TLS terminates at the operator's ingress (ADR-20 - 036 documents a cloud-LB recipe and ships an optional auto-cert Caddy overlay); internal hops are private-network HTTP at launch (enterprise mTLS upgrade documented). HSTS at the ingress (stated in both recipes). Cookies: httpOnly + `Secure` + `SameSite=Lax` everywhere (asserted in tests, 029/031). **CSRF:** SameSite=Lax is the primary control; BFF route handlers additionally enforce Origin/Sec-Fetch-Site checks on state-changing requests (belt for older clients); no cross-origin API exists (BFF pattern eliminates CORS entirely - no CORS headers are ever set, and their absence is a test). **Headers** (both Next apps + API): CSP (default-src 'self'; portal allows the Turnstile origin only when the adapter is active; no unsafe-inline - nonce-based if Next requires), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'` (portal embedding of forms is a Phase-4 decision, not an accident). Request body size limits at the API (enforced) and at the ingress (documented in the recipes). Delivered: 017 (API headers/limits), 029/031 (apps), 036 (proxy).

## 6. Secrets management - SEC-8

All secrets arrive via environment (12-factor; adopters bring their secret manager - examples for Docker secrets and plain env documented). The Zod config schema (017) validates presence *and shape* (min lengths) at boot - fail fast, and **never echo values** in errors or logs (redaction test). At-rest encryption for secrets we must read back (webhook secrets): AES-256-GCM under `QCMS_APP_KEY` via WebCrypto (fetch-pure), versioned ciphertext format for key rotation. `.env.example` (037 scaffold) contains placeholders + generation commands (`openssl rand -base64 32`), never defaults that work - a deployment with placeholder secrets must refuse to boot. Log hygiene: structured logger redacts known secret fields; **answer values are never logged** (respondent PII - log questionIds and counts, not content); tokens never appear in URLs (headers/cookies/body only - secure links are the sole, deliberate exception, mitigated by expiry + server-side state).

## 7. Data protection

PII stance: **all answer content is treated as PII** regardless of question semantics - no classification guesswork. Controls, all delivered by existing tasks: append-only ledger + version-pinned sessions (audit), retention sweep with TTL defaults (015), ADR-17 hard erasure + tombstone + reporting exclusion (016, 023, 035), backups documented with the honest note that erasure ages out of backups per the operator's retention (016 docs), reporting view consumed via a **read-only DB role** whose `CREATE ROLE` grant ships in the docs (015) - BI tools never get the app credential. The API's DB user gets least privilege consistent with the erasure door (013/016): no superuser, no DDL beyond migrations (migration step may use a separate role - 036 documents the split).

## 8. Abuse resistance

Owned by 026 (rate limits, honeypot, min-time, session binding, challenge adapter) - see that task; this document adds the *placement* rule: model-guarding protections live in the API, vendor-shaped challenges in the shell, absorption-scale defense (DDoS) at the ingress/CDN and explicitly on the operator.

**Agent-assisted authoring (ADR-25, flag-gated).** The assist surface is admin-only (behind 2FA auth), off by default, and adds one egress path: outbound LLM-provider calls carrying **form structure only - respondent answers are structurally unreachable from the agent's tool surface** (the PII boundary is the allowlist, not a prompt). Prompt injection is bounded the same way: the allowlist is enforced server-side (draft mutation + validation only; never publish/erase/links/webhooks), every proposal passes kernel validation, and publish remains a human act. The provider key follows SEC-8 (validated iff the flag is on, never logged). 040 covers the surface when enabled.

## 9. Supply chain and release security - SEC-11

Lockfile committed and frozen in CI (`--frozen-lockfile`); `pnpm audit` + osv-scanner in CI (fail on high/critical with a documented triage path); Dependabot/Renovate enabled; minimal dependency policy (the 010 decision to hand-roll tokens over a JWT lib is the pattern). Vendored `a2-react-aria` component sources (ADR-22) enter the repo via `@a2ra/cli add` and are reviewed in their PR like any first-party code - no postinstall scripts, no opaque bundles. npm publishing: 2FA on the npm account, provenance attestations (`npm publish --provenance`) for all `@qcms/*` packages, publish only from CI on tagged releases. Docker images: pinned base digests, non-root, SBOM (036). The scaffold (037) must never contain a real secret - a scaffold-output scan is part of its CI. GitHub: branch protection, required CI, no force-push to main.

## 10. Assurance plan and traceability - SEC-12

**Continuous (every stage):** security-relevant exit criteria already embedded in tasks - the matrix below is the audit trail. **Pre-launch:** task **040** runs a structured security review (checklist from this document: authn/authz matrix enforcement tests, header/cookie/CSRF verification, secrets redaction, dependency and scaffold scans, an OWASP ASVS L2-oriented pass over the API) and fixes or tickets findings; launch (038) requires zero open high-severity findings. **Post-launch:** `SECURITY.md` in the repo (vulnerability disclosure: private reporting via GitHub security advisories, response-time commitment, supported-versions table); security patches released as patch versions with advisories; adopter notification via release notes + advisory.

| Control | Designed | Delivered / verified |
|---|---|---|
| Admin authn + 2FA (SEC-1) | §2.1 | 031 · 040 |
| Respondent tokens + secure links (SEC-2) | §2.2 | 010, 018, 024 · 027 |
| Authorization matrix (SEC-3) | §3 | 017, 021–023 · **040 matrix tests** |
| Service channel auth (SEC-4) | §2.3 | 017, 029, 031 · 040 |
| `/api/v1` scopes (SEC-5, reserved) | §2.4 | route annotations in 021–024 · Phase 4 (039) |
| Webhook signing + secret handling (SEC-6) | §2.5 | 024, 025 · 027 |
| Key inventory + rotation (SEC-7) | §4 | 010, 017, 024, 036 runbooks · 040 |
| Secrets handling + redaction (SEC-8) | §6 | 017, 037 · 040 |
| Transport/browser hardening (SEC-9) | §5 | 017, 029, 031, 036 · 040 |
| Least-privilege DB roles (SEC-10) | §7 | 013, 015, 036 · 040 |
| Supply chain (SEC-11) | §9 | 001 (CI), 036, 037 · 040 |
| Review + disclosure (SEC-12) | §10 | **040**, 038 gate |

**Consistency notes against existing docs:** `ARCHITECTURE.md` §5.1's table gains the internal service token implicitly (SEC-4) - no contradiction; 017's config schema grows `QCMS_SESSION_KEYS`, `QCMS_INTERNAL_TOKEN`, `QCMS_APP_KEY` and 010 generalizes to purpose-tagged tokens - **task files 010/017/018 were corrected in place (2026-07-19)** per the staleness rule (`AGENTIC_DEVELOPMENT.md` §1.1); 018's session token is ratified as SEC-2. If a conflict between a task file and this document is discovered later, this document wins and the task file is corrected in the same change.
