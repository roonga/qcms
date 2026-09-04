# QCMS - Security Design

**Status:** authoritative · companion to `ARCHITECTURE.md` (§5.1, §7, §8)
**Decisions here are numbered SEC-1…SEC-13** and carry ADR weight; conflicts are flagged, not silently overridden.
**Delivery:** every control maps to implementation or active work in the traceability matrix (§10).

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
api ──[B6: egress]──▶ api.pwnedpasswords.com (admin password set only)
```

- **B1** internet→portal: TLS terminates at the operator's ingress (ADR-20: cloud LB, or the optional Caddy overlay); everything hostile arrives here. Ingress routes only portal and admin - the API container publishes no port.
- **B2** BFF→API: internal network; authenticated in-band anyway (SEC-4).
- **B3** API→Postgres: credentialed, private network, least-privilege DB roles (SEC-10).
- **B4** operator/author→admin: VPN in enterprise; TLS + auth in solo.
- **B5** API→consumers: outbound only; signed (SEC-6); SSRF-guarded (024).
- **B6** API→`api.pwnedpasswords.com`: outbound only, one fixed host, reached **only** while an admin password is being set (SEC-1, issue #178). Carries the first five hex characters of the password's SHA-1 and nothing else - no identifier, no answer data, no credential. Fail-closed, and disableable for an offline deployment with `QCMS_ADMIN_PASSWORD_BREACH_CHECK=false`.

**Out of scope of the software (documented operator responsibility):** host/OS hardening, VPN configuration, ingress/TLS provisioning (ADR-20; recipes in 036), Postgres server hardening, DDoS absorption (ingress/CDN concern), physical security, backup media custody.

## 2. Authentication

### 2.1 Admin users (authors/operators) - SEC-1

better-auth in-process **in the API** (ADR-06; ADR-35 as amended 2026-07-31, implemented by task 056), email + password with **TOTP 2FA enforced by default** (`QCMS_ADMIN_2FA=optional` dev escape hatch), recovery codes generated at enrollment and regenerable thereafter (see the recovery-code note below).
Password policy: a **compromised-password check against the public breach corpus**, plus a 12-character length floor and no composition rules at all; passwords hashed by better-auth's default (argon2id or scrypt - verify and pin).
Session: httpOnly, `SameSite=Lax`, `Secure` cookies; absolute lifetime 12h, idle timeout 1h (configurable); server-side session invalidation on sign-out and password change.
Sign-in throttling: better-auth's per-client-address limiter over `/sign-in`, `/sign-up`, `/change-password`, `/change-email` and `/two-factor/*`, three attempts per ten seconds, keyed on the address the admin BFF vouched for (issue #374) and **switched by `QCMS_ADMIN_SIGNIN_THROTTLE`, default on in every environment** (issue #390).
`NODE_ENV` decides nothing here, deliberately: it used to, by way of the vendor's own default, which meant a general-purpose variable decided a security control and a process started outside the shipped images served an unthrottled sign-in surface with nothing saying so.
Setting the variable false is a development escape hatch and the only way to turn the control off; the API logs a warn line naming it at every boot for as long as it is off, read back off the limiter's resolved context rather than off the configuration.
Generic failure messages (no user enumeration - same response for unknown email and wrong password).
First admin via `qcms:create-admin` CLI only; **no self-registration path exists in any composition**.
Delivered: 031, with the breach check added by issue #178 and the throttle switch by issue #390; 040 verifies SEC-1 as a system.

**The password policy, amended 2026-08-09 (issue #178).**
This section used to promise a "zxcvbn-style strength check (min score, not composition rules)".
That was the wrong control, checked against the standards rather than assumed: **NIST SP 800-63B Rev 4 section 3.1.1.2** says a verifier **SHALL** compare a prospective secret against a blocklist of known commonly used, expected or compromised passwords and **SHALL NOT** impose composition rules, and **OWASP ASVS 5.0 6.2.12** requires a breached-password check at L2.
Neither asks for an entropy score.
So the old wording promised something no standard requires while omitting the one they mandate, and the amendment moves toward current guidance rather than away from it.
A strength **meter** remains a legitimate later UX enhancement (the OWASP Authentication Cheat Sheet still recommends one, naming `zxcvbn-ts`); it is not the control.

What runs is better-auth's first-party `haveIBeenPwned` plugin, which ships inside the already-pinned `better-auth` and is re-exported from `better-auth/plugins`: **no package entered the dependency tree.**
It SHA-1s the candidate password, sends the **first five hex characters** of that hash to `api.pwnedpasswords.com/range/{prefix}` with `Add-Padding: true`, and matches the suffix in-process.
The password never leaves the process, and the five-character prefix is all the endpoint learns: about two thousand corpus entries share any one range (measured 2026-08-09 across six prefixes: 1921 to 2509 entries, unpadded), and vastly more possible passwords than that do, so the request discloses nothing usable (SEC-8).
It hooks better-auth's password-hashing step, so it applies wherever a password is set rather than at one call site, and the vendor's default `paths` are left alone: they already cover both of QCMS's reachable entry points (`/change-password` over the mount, `/sign-up/email` in-process from the CLI) and the other five are unreachable behind the endpoint allowlist above.

**Failure semantics: fail-closed, with a config-plane knob.**
An unreachable corpus refuses the password rather than waving it through.
Fail-open-with-a-warning was considered and rejected: a warning nobody reads turns a SHALL into a sometimes.
Fail-closed is affordable here because neither caller is on an unrepeatable path - `qcms:create-admin` is run-once and re-runnable, and change-password is retryable.
A deployment that is _structurally_ offline sets `QCMS_ADMIN_PASSWORD_BREACH_CHECK=false` (default **true**), which is a decision the deployer makes in configuration a reviewer can read, not a runtime bypass an attacker can reach; both the API server and the CLI log a loud line at startup while it is off.
That knob is also the deliberate break-glass for the one case where fail-closed genuinely costs an operator something: rotating a leaked password while the corpus is unreachable, mid-incident.

**What an air-gapped deployment actually does, traced rather than inferred.**
`bootstrap.ts` calls `signUpEmail` in process, and the plugin gates on the current endpoint path, so whether it fires for a non-HTTP call was an open question.
It was run: against a real database with `api.pwnedpasswords.com` blackholed at the resolver, an in-process `qcms:create-admin` **does** attempt the lookup and **does** fail closed, answering `500` with "Failed to check password. Please try again later." With the host reachable and a corpus password, the same call answers `400 PASSWORD_COMPROMISED` after exactly one request to `/range/{prefix}`.
So **first-admin creation is impossible on an air-gapped deployment without the knob**, which is precisely why the knob exists.
The CLI reports both outcomes as a named refusal with an actionable line rather than crashing (`describeRefusal`), and never echoes the password or any part of its hash.

**The corpus refusal is shown specifically at the admin change-password surface, and the oracle that costs is accepted knowingly (Code Owner ruling, 2026-09-03; issue #437).**
Every other failure on that form reports one generic sentence, because SEC-1 requires a wrong current password to be indistinguishable from a rejected new one; a corpus hit is the single exception, mapped to copy that says the password appears in public breach data and to choose another.
The cost is that better-auth 1.7.2 hashes the new password - where the check hooks - before it verifies the current one (`dist/api/routes/update-user.mjs:174` against `:175-178`, measured on issue #437 and re-read at this version), so the specific copy is visible to any session holder whether or not they know the current password: a corpus-membership oracle for arbitrary candidates.
It is accepted because the corpus is pwnedpasswords, a free public API anyone may query anonymously, so the oracle duplicates information already available at the source and the marginal leak is effectively nil against a real gain for a legitimate admin.
Rejected: pre-verifying the current password first (an extra round trip or an upstream reorder, buying the closure of an oracle whose contents are public) and keeping the generic failure (the gap the issue exists for).
The change is display only - the refusal, its status, its timing and its ordering are unchanged - and lives in `apps/admin/lib/server/password-refusal.ts`.

**Operational dependency.** The package tree is unchanged, but this adds a **runtime egress dependency on `api.pwnedpasswords.com`** for the two admin password-setting paths, on a deployment that previously needed no outbound access for authentication at all. It is recorded in the operator surface (`docs/operations.md`) as well as here, because it is a new fact about the deployment even though it is not a new fact about the build.

**Where the endpoints live, and how "no self-registration path" survives an HTTP mount (task 056).**
The instance moved from the admin app into the API, mounted on `/api/auth/*` per better-auth's documented Hono integration.
That integration is a single catch-all handler, and a bare one publishes `POST /api/auth/sign-up/email` as a side effect of wanting the sign-in endpoints - so the mount keeps the vendor's handler shape and puts an **explicit endpoint allowlist** in front of it.
Eight operations are reachable (`sign-in/email`, `get-session`, `sign-out`, `change-password`, `two-factor/enable`, `two-factor/verify-totp`, `two-factor/verify-backup-code`, and `two-factor/generate-backup-codes`, added by issue #319 as the password-gated replacement for the removed recovery-code read-back route); everything else, `sign-up/email` included, answers `404` with a message that names no endpoint.
`signUpEmail` remains callable **in process only**, from the first-run CLI behind its zero-admins guard, which is the distinction this control has always drawn: a route is HTTP-reachable and a command line is not.
The guarantee is asserted on both sides - `apps/api/src/features/auth/auth-mount.test.ts` posts to the sign-up path and requires a 404, and the admin keeps its structural test that no catch-all route exists under `app/`.

**Recovery codes: what they are, and the standard this deliberately deviates from (issue #319).**
Ten single-use codes per account, generated by better-auth at enrollment, **shown at enrollment and regenerable thereafter**, **stored encrypted at rest** under the versioned admin auth key (§4), single-use, and subject to the same 2FA lockout accounting as a TOTP code.
Regeneration is `POST /two-factor/generate-backup-codes`, which better-auth gates on the **account password**, and it replaces the set on record - so it re-authenticates the operator and retires any leaked prior set in one step.
Nothing anywhere reads the stored codes back: the QCMS route that did (`POST /admin/auth/recovery-codes`, task 056) is removed, because retrieval-on-demand is what made "shown once" untrue, and better-auth's own guidance for the function it wrapped asks for a freshly created session, which `AdminPrincipal` cannot express.

**This is a deviation, recorded as one.**
NIST SP 800-63B (look-up secrets) and OWASP ASVS V2.6.2 both require look-up secrets to be stored **hashed**, not reversibly encrypted.
QCMS stores them encrypted, and the reason is the library's verification design rather than a judgement that the two are equivalent: better-auth verifies a submitted code with `codes.includes(data.code)` against the **decrypted plaintext array** (`dist/plugins/two-factor/backup-codes/index.mjs:33-43`), and the storage hook it exposes (`storeBackupCodes`) is a matched `{ encrypt, decrypt }` pair whose `decrypt` never receives the submitted code.
A one-way hash cannot satisfy that contract, so hashing means replacing better-auth's verify path (and with it session issuance, the trusted-device cookie and the lockout accounting).
The residual risk is explicit: an attacker who holds **both** a database read **and** `QCMS_ADMIN_AUTH_SECRET` recovers usable second factors.
A database read alone does not, which is the property §4's "encrypted at rest" row asserts and which `apps/api/src/features/auth/backup-code-storage.integration.test.ts` asserts against the column.
040 should see this reasoning rather than inherit a quietly relaxed promise.

**The proxied hop.**
The browser talks only to the admin origin.
The admin's named BFF route handlers forward one operation each over the SEC-4 internal channel and re-emit better-auth's `Set-Cookie` headers verbatim on their own 303, so the session and two-factor cookies land first-party to the admin with their `HttpOnly`, `SameSite=Lax` and `Secure` attributes unchanged, and no CORS header is ever needed.
Only a curated header set crosses the hop (`cookie`, `origin`, `referer`, `user-agent`, `accept-language`, `x-forwarded-proto` and the Fetch Metadata triplet).
`X-Forwarded-For` and `X-Real-IP` are **not** among them: they used to be, relayed verbatim so that per-IP sign-in throttling had an address to key on, and that made the throttle forgeable, since the browser writes both and a caller rotating one bought a fresh backoff allowance every attempt.
What crosses instead is `X-QCMS-Client-Address`, the single address the admin resolved from its own inbound chain by counting `QCMS_ADMIN_TRUSTED_PROXY_HOPS` entries from the right, and better-auth is configured to resolve the client address from that header alone (issue #374, §8).
Nothing verifies a session by cookie signature alone at any point: the admin resolves a session by asking the API, which reads the row.

### 2.2 Respondents - SEC-2

Launch modes only (OTP/social are Phase 4 behind the same seam):

- **Anonymous:** `POST /sessions` issues a **session token** - HMAC-signed compact token (010 machinery) with claims `{ sessionId, purpose: "session" }`, held by the portal BFF in an httpOnly `SameSite=Lax` `Secure` cookie, path-scoped, lifetime = session TTL. The token authorizes exactly one session and nothing else. Client JS never sees it (R2 - the BFF attaches it as a bearer header on internal calls).
- **Secure links:** signed, expiring, single-form tokens (010): claims `{ formId, linkId, expiresAt, oneTime? }`, HMAC-SHA256, base64url; server-side state (`secure_links`) adds revocation and atomic one-time consumption - _a signature alone is never sufficient; the row must agree_. No PII in tokens, ever. Verifying a link mints a session; from then on the session token is the credential.

Distinct signing keys per purpose (session vs link - SEC-7); purpose claim checked on verify so tokens cannot be cross-used. Delivered: 010, 018, 024.

### 2.3 Service-to-service (BFF → API) - SEC-4

Primary control is topology: public API processes mount only respondent groups (ADR-09); admin groups don't exist there.
Defense-in-depth in-band: both BFFs attach a deployment-scoped **internal service token** (`QCMS_INTERNAL_TOKEN`, ≥32 random bytes, from config) on every call to the API; the API rejects internal-surface requests without it.
This is deliberately a static shared secret, not mTLS or a token service - the solo operability budget rules those out; the enterprise recipe documents upgrading to mTLS at the mesh/proxy layer as an operator choice.
End-user authorization always comes from the _user's_ credential (admin session or session token) forwarded by the BFF - the service token authenticates the _channel_, never the user.
Delivered: 017 (middleware + config), 029/031 (BFF attachment).

**The auth group's relationship to this control (task 056).**
`/api/auth/*` carries the internal service token like every other mounted group, and carries **no** admin-session gate - it cannot, since these are the endpoints that issue the session.
That is consistent with the rule above rather than an exception to it: the channel token is doing exactly its stated job (this call came from a trusted app, over a network nobody else is on), and there is no end-user credential to forward yet.
The group is mounted only where the admin surface is (`QCMS_MOUNT` includes `admin`), so a respondent-only process has no identity provider at all - a request to a sign-in path there is a 404, not a 403 (ADR-09).
Combined with ADR-20's rule that the API container is never published, the practical exposure of an unauthenticated-by-design auth endpoint is the internal network plus a ≥32-byte shared secret, which is the same posture every admin route already has.

### 2.4 Machine consumers (`/api/v1`) - SEC-5, reserved

De-scoped at launch (ADR-10), **designed now** so the seam is real:

- **Credential:** opaque personal-access-style tokens, prefix `qcms_pat_`, ≥32 random bytes; stored **hashed** (SHA-256) - displayable once at creation; per-token expiry (max 1 year, default 90 days), last-used tracking, revocation.
- **Scopes** (granted per token, checked per route; the taxonomy is fixed now so route annotations exist from day one):

| Scope                                | Grants                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms:read`                         | Read forms, versions, published snapshots                                                                                                                                                                                    |
| `forms:write`                        | Draft CRUD, publish                                                                                                                                                                                                          |
| `questions:read` / `questions:write` | Library read / library authoring                                                                                                                                                                                             |
| `responses:read`                     | List and read submissions                                                                                                                                                                                                    |
| `responses:write`                    | Respondent write endpoints: start a session (`POST /sessions`), submit an answer (`POST /sessions/{id}/answers`), submit the session (`POST /sessions/{id}/submit`). Does not imply `responses:read` (grant both explicitly) |
| `responses:export`                   | Bulk export endpoints                                                                                                                                                                                                        |
| `responses:erase`                    | Erasure (never bundled into broad grants; must be explicit)                                                                                                                                                                  |
| `links:mint`                         | Mint/revoke secure links                                                                                                                                                                                                     |
| `webhooks:manage`                    | Webhook config                                                                                                                                                                                                               |

- Rules: scopes are additive, no implicit hierarchies; `*:write` does not imply `*:read` is _granted_ implicitly (grant both explicitly - dumb and auditable); erase is never part of any preset. Per-token rate limits. OpenAPI security scheme generated with the routes (`@hono/zod-openapi`). Delivered: Phase 4 (039 item 3) - but 021–024 slice authors annotate intended scopes in route metadata as they build, so activation is wiring, not archaeology. Scope annotations ride in the `@hono/zod-openapi` route definitions (017's convention) and surface in the generated internal OpenAPI documents (027).

### 2.5 Webhook egress - SEC-6

Consumers authenticate _us_: `X-QCMS-Signature: v1=HMAC-SHA256(secret, timestamp + "." + body)` with `X-QCMS-Timestamp`; consumers reject skew > 5 min (replay bound) and verify constant-time. Per-webhook secrets, generated server-side, shown once, encrypted at rest (SEC-8), re-issued per webhook from the admin. Delivered: 024, 025.

**Re-issuing a secret is a hard cutover, not an overlap (issue #453).**
This paragraph previously specified "rotatable with overlap (old+new both signed during a documented window)" and marked it delivered.
It was designed and never built: `signWebhookBody` (`apps/api/src/features/webhooks/signing.ts:36-49`) takes a single secret and returns a single `v1=<hex>` value, and a delivery carries one `X-QCMS-Signature` header.
The `v1=` prefix is a scheme version, not a key id, so it cannot distinguish two live secrets either.
What that costs an operator, and the re-issue then redeliver sequence that recovers it, is in the SEC-7 note in section 4.
Whether to build the overlap window is open.

## 3. Authorization

### 3.1 Launch model - SEC-3

One human role: **admin** (full authoring surface). The session context carries a `role` claim from day one so RBAC is additive (Phase 4 sketch: `admin` / `author` (no webhook config, no erasure) / `viewer` (responses read-only) - recorded as an issue, not built, R7). Authorization is enforced **in the API layer** (middleware per route group + per-route checks), never in the BFF (R2) and never only in the UI.

Respondent authorization is structural: a session token authorizes exactly `{read step, answer, submit}` on its one session; there is no respondent-facing list/enumerate anything. Session IDs are non-sequential (branded random ids) - but possession of an ID grants nothing without the signed token.

### 3.2 Authorization matrix (launch)

| Action                            | Anonymous          | Session-token holder | Admin (2FA session)                     | Internal service token alone |
| --------------------------------- | ------------------ | -------------------- | --------------------------------------- | ---------------------------- |
| Start anonymous session           | ✔ (rate-limited)   | -                    | ✔                                       | ✖                            |
| Redeem secure link                | ✔ with valid token | -                    | -                                       | ✖                            |
| Get step / answer / submit        | ✖                  | ✔ own session only   | ✖ (admins use preview)                  | ✖                            |
| Question/form authoring, publish  | ✖                  | ✖                    | ✔                                       | ✖                            |
| Responses read/export             | ✖                  | ✖                    | ✔                                       | ✖                            |
| Erasure                           | ✖                  | ✖                    | ✔ (confirmed UI / explicit scope later) | ✖                            |
| Links mint/revoke, webhook config | ✖                  | ✖                    | ✔                                       | ✖                            |
| Health/ready                      | ✔                  | ✔                    | ✔                                       | ✔                            |

The service token authorizes no action by itself - it only opens the channel (SEC-4). Enforcement tests for this matrix are `apps/api/e2e/security/01-authorization-matrix.e2e.ts` (task 040): the rows are declared as data and walked once per credential shape, with a positive control ahead of every negative case.

**One reading of the "Internal service token alone" column, recorded during 040 because the table and the code differ on one cell.**
That column carries a cross on every row **except `Health/ready`**, which is a tick two lines above; among the rows it crosses is "Start anonymous session", and in the code `POST /sessions` carrying only the channel token answers `201`.
It has to: that is exactly how the portal BFF starts a session for an anonymous respondent, and the same row's first column already marks it reachable by anonymous callers.
The column means **the service token confers no identity, and therefore no authorized action** - not that any request carrying it alone is refused.
The control on that row is rate limiting (026), not authentication.
The cell is left as it is because it records the right property; this paragraph records how to read it.

## 4. Token and key inventory - SEC-7

| Credential                              | Format                               | Lifetime                        | Stored                                                             | Rotation                                                                                          |
| --------------------------------------- | ------------------------------------ | ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Admin password                          | argon2id/scrypt hash                 | until changed                   | hashed (better-auth)                                               | user-driven; sessions invalidated                                                                 |
| Admin session                           | better-auth cookie                   | 12h abs / 1h idle               | server-side session                                                | sign-out, password change                                                                         |
| Admin auth signing secret               | `QCMS_ADMIN_AUTH_SECRET` (≥32 chars) | until rotated                   | config only, **API process** (task 056)                            | versioned key list `QCMS_ADMIN_AUTH_SECRETS` - see the note below                                 |
| TOTP secret / recovery codes            | per better-auth                      | until re-enrolled / regenerated | **encrypted at rest** under the admin auth key, versioned envelope | recovery codes: regenerate (password-gated); key: the versioned list                              |
| Respondent session token                | HMAC compact (010)                   | session TTL                     | not stored (stateless + session row)                               | key: `QCMS_SESSION_KEYS` list                                                                     |
| Secure link                             | HMAC compact (010)                   | link expiry                     | state row (`secure_links`)                                         | key: `QCMS_LINK_KEYS` list                                                                        |
| Internal service token                  | random ≥32B                          | until rotated                   | config only                                                        | overlap via accepted-list                                                                         |
| Webhook secret                          | `whsec_` + 32B random (base64url)    | until re-issued                 | **encrypted at rest** (SEC-8)                                      | re-issue per webhook (admin **Rotate secret**); **hard cutover, no overlap** - see the note below |
| `/api/v1` PAT _(reserved)_              | `qcms_pat_` random                   | ≤ 90d default                   | hashed                                                             | revoke + reissue                                                                                  |
| App encryption key                      | `QCMS_APP_KEY` (≥32 chars)           | set once                        | config only                                                        | **no in-place rotation**; recoverable by re-issuing webhook secrets - see the note below          |
| LLM provider key _(flag-gated, ADR-25)_ | `QCMS_AGENT_API_KEY`                 | until rotated                   | config only; required iff `QCMS_FLAG_AGENT_AUTHORING` ≠ `none`     | rotate at provider + config                                                                       |

All key-list envs accept multiple keys: first entry signs, all verify (010's rotation model generalized). Rotation runbooks live in `docs/operations.md` (036).

**Every cell in the Rotation column above is verified against the code, not against intent (2026-08-13).**
That sentence is here because it was not previously true: this table reads as a specification of what exists, and two of its cells described capabilities that were designed and never built.
Both are now corrected in place, and a cell that names a capability should be treated as a claim a reader may check.
What was verified this pass, so task 040 need not re-derive it: `QCMS_SESSION_KEYS`, `QCMS_LINK_KEYS` and `QCMS_INTERNAL_TOKEN` are genuinely accepted lists (`apps/api/src/config.ts:723-725`, all three through `parseKeyList`, first signs and all verify); the admin password row's "sessions invalidated" is real (`apps/api/src/features/auth/route.ts:73`, `POST /change-password` with `revokeOtherSessions`); and the `/api/v1` PAT row is marked _reserved_ because that surface is unbuilt, which is a deliberate placeholder rather than a claim.

**The webhook secret has no dual-signing window, and this row previously said it did (issue #453).**

A delivery carries exactly one signature. `signWebhookBody` (`apps/api/src/features/webhooks/signing.ts:36-49`) takes a single `secret` and returns a single `v1=<hex>` value, and the wire format is one `X-QCMS-Signature` header. There is no overlap period in which either the old or the new secret verifies, so re-issuing a webhook's secret is a **hard cutover**: every delivery to that endpoint fails at the consumer until the consumer is updated. The `v1=` prefix is a scheme version, not a key id, and so cannot be used to distinguish two live secrets.

What does exist, and is worth stating because it makes the cutover recoverable rather than lossy: the admin's per-webhook **Rotate secret** action mints a fresh secret and encrypts it under the current app key **without reading the old one** (`apps/api/src/features/webhooks/handler.ts:186-192`), and a redelivery picks up the endpoint's _current_ secret rather than one snapshotted at enqueue, because the due-claim query joins `webhooks` live and selects `secretEncrypted` at claim time (`packages/db/src/queries/deliveries.ts:255-265`).
So the recovery sequence is: re-issue, hand the consumer the new secret, then redeliver what dead-lettered in between.
That ordering is licensed by a data-freshness property of the claim query, which is checkable rather than assumed.

Building the overlap window is a product change, not a documentation one, and is tracked separately. This paragraph records what ships today.

**`QCMS_ADMIN_AUTH_SECRET` is a special case, and this paragraph replaces what task 056 recorded here, in both directions (issue #319).**

Task 056 wrote down two claims.
The first was that this key has no rotation story at all, so changing it destroys every enrolled account's authenticator permanently.
The second was that the recovery codes survive such a change, because QCMS configures no `storeBackupCodes` and better-auth's default stores them as plain JSON.
**The first is now false and the second was never true**, and the second is the more instructive error: it was reached by reading the _decoder_ (`dist/plugins/two-factor/backup-codes/index.mjs:45`, which plain-JSON parses when the option is absent) without reading the caller that supplies it (`dist/plugins/two-factor/index.mjs:25-27`), which defaults `storeBackupCodes` to `"encrypted"`.
Asserted against the stored column, not against the type: `apps/api/src/features/auth/backup-code-storage.integration.test.ts`.

So **both** stored factors are ciphertext under this key, and always have been: the TOTP secret (`dist/plugins/two-factor/index.mjs:135`) and the recovery codes (`.../backup-codes/index.mjs:19-22`, ten per account per `:15`, `amount ?? 10`). There was never an accidental last door standing open behind a lost auth secret, which matters for how the break-glass gap is prioritised (issue #432): it is a real gap and not a newly created one.

**What is genuinely new is the rotation path.** better-auth 1.7.2, the version this repo pins, carries a versioned key set: `secrets?: Array<{ version, value }>` (`@better-auth/core/dist/types/init-options.d.mts:507,518`).
`symmetricEncrypt` writes a `$ba$<version>$<hex>` envelope under the current version, `symmetricDecrypt` selects the key by the envelope's version, and the singular `secret` is retained as a **legacy fallback** for bare-hex ciphertext written before the envelope existed (`dist/crypto/index.mjs`).
QCMS wires this as `QCMS_ADMIN_AUTH_SECRETS`, defaulting to a single version-1 entry holding `QCMS_ADMIN_AUTH_SECRET`, so a deployment that never rotates behaves exactly as it did.

Rotation is therefore additive rather than destructive: add a new version at the head of the list, keep the old one for reading, and stored material re-encodes under the current version **as it is used** - recovery-code blobs on every redemption (`.../backup-codes/index.mjs:215`). Three limits, stated rather than implied:

- **Live sessions end.** better-auth derives its cookie-signing secret from the current version (`dist/context/create-context.mjs:75`), so promoting a new version signs every admin out. That is the correct consequence of a key change; it is not the loss of a factor.
- **The TOTP secret does not re-encode on use.** It is written once at enrollment and only read afterwards, so it stays readable through whichever version wrote it (or through the legacy fallback) and never migrates forward on its own. Retiring an old version means re-enrolling accounts whose secret was written under it.
- **A retired version is retired, and at launch there is no supported way to retire one.** Dropping a version makes anything still encoded under it unreadable, and because TOTP secrets never migrate and the admin surface exposes no re-enrolment for an account with a live factor (`two-factor/disable` is unmounted), the list only grows. Pruning becomes possible once a 2FA reset exists (issue #432).

The runbook is in `docs/operations.md`.

**`QCMS_APP_KEY` is the other at-rest key, and it is a different shape of loss from the one above (issue #323).**
It is a single scalar rather than a key list, and the stored envelope (`v1.<base64(iv || ciphertext || tag)>`) carries a **scheme** version but **no key id**, so nothing in the database records which key encrypted a given row.
There is no in-place rotation and no re-encrypt job.
It protects exactly one column, `webhooks.secret_encrypted`, holding the per-webhook HMAC signing secret, so changing the value makes every stored webhook secret undecryptable at once: the delivery scheduler records `secret_decrypt_failed` and those deliveries dead-letter.

**Unlike `QCMS_ADMIN_AUTH_SECRET`, this is recoverable without the old key**, and the difference matters operationally.
The webhook secret is server-generated and can be replaced without ever reading the old one, so the way back is to rotate each webhook's secret in the admin ("Rotate secret" on the form's Webhooks page), hand each consumer its new secret, and redeliver the dead-lettered items.
The cost is re-coordinating a shared secret with every webhook consumer, plus the deliveries that dead-lettered in between.
**It is not data loss.**
Treat the key as set-once and back it up with the database all the same, because that recovery is manual and paced by other people's release cycles.
Turning it into an accepted-list key, so that a re-encrypt pass could run online with no dead-letter window, is Phase 4 work (issue #466).
The runbook is in `docs/operations.md`.

## 5. Transport and browser security - SEC-9

TLS terminates at the operator's ingress (ADR-20 - 036 documents a cloud-LB recipe and ships an optional auto-cert Caddy overlay); internal hops are private-network HTTP at launch (enterprise mTLS upgrade documented).
HSTS at the ingress (stated in both recipes).
Cookies: httpOnly + `Secure` + `SameSite=Lax` everywhere (asserted in tests, 029/031).
**CSRF:** SameSite=Lax is the primary control; **both** Next apps' BFF route handlers additionally enforce Origin/Sec-Fetch-Site checks on state-changing requests, via `isSameOriginPost` in each app's `lib/server/route-helpers.ts`.
The portal's copy landed in issue #487: this sentence had claimed it of both apps while only the admin had it, for four state-changing handlers, which is why the claim is now held up by a gate rather than by a convention.
`scripts/check-origin-guards.test.ts` derives every state-changing route handler in every app from disk and asserts each one calls the belt by name, so an app that acquires a handler without it, or loses the belt entirely, is a red rather than a silence.
Note that `Sec-Fetch-Site` is the header doing the work, not a fallback for old clients: `Referrer-Policy: no-referrer` makes a form POST serialize its `Origin` as the literal `null`, so the `Origin` comparison only ever matches on the hydrated `fetch()` path.
A client sending no Fetch Metadata at all is refused.
On the admin that is an unremarkable staff-browser baseline; on the **portal** it is a real cost on a public respondent surface, because the two endpoints reached by an HTML form navigation (`POST /f/{formSlug}/start` and the no-JS `POST /s/{sessionId}/step`) are the ones with no fallback, and the first of those is the Begin button on every path, hydrated or not, so anonymous entry is a hard block for such a client.
Secure-link entry is not: `/l/{token}` is a GET the belt does not cover, so an affected browser starts fine and, with JavaScript, completes normally.
The fully locked-out population is therefore anonymous-entry respondents plus no-JS secure-link respondents, not every affected browser.
Measured at roughly 1.6% of global traffic (July 2026, and a floor rather than a point estimate), concentrated in legacy-enterprise and old-desktop markets.
Tracked as issue #504; the operator-facing symptom, the numbers and what to tell a respondent are the first runbook in `docs/operations.md`.
No cross-origin API exists (BFF pattern eliminates CORS entirely - no CORS headers are ever set, and their absence is a test).
**Headers** (both Next apps + API): CSP (default-src 'self'; portal allows the Turnstile origin only when the adapter is active; no unsafe-inline - nonce-based if Next requires), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` (portal embedding of forms is a Phase-4 decision, not an accident).
Request body size limits at the API (enforced) and at the ingress (documented in the recipes).
Delivered: 017 (API headers/limits), 029/031 (apps), 036 (proxy).

**Found by task 040 and closed since (issue #487, fact refresh 2026-08-15).**
When 040 reviewed this section the sentence above claimed the Origin/Sec-Fetch-Site belt of "BFF route handlers" unqualified, and only the admin had it: the portal's four state-changing handlers (`/f/[formSlug]/start`, `/s/[sessionId]/answers`, `/s/[sessionId]/step`, `/s/[sessionId]/submit`) rested on SameSite=Lax alone.
That was a real finding and is recorded as one in `docs/security-review-2026-08-14.md`; the exposure was bounded, because a respondent session authorizes only `{read step, answer, submit}` on exactly one session (SEC-2, SEC-3).
**It is now fixed**, in `2816ec1`, which gave the portal the same helper and - the durable half - replaced the convention with `scripts/check-origin-guards.test.ts`, so the claim the sentence above makes is held up by a derived check rather than by memory.
Recorded rather than deleted because it is the fourth instance of the same pattern 040 kept finding: a control present in one app, absent in its twin, with a document asserting it of both (compare #470, #401, #402, #471).

**Corrected 2026-08-14 (task 040, issue #471): this paragraph marked the API's headers delivered by 017 and the API set none of them.**
They are set now, by `apps/api/src/middleware/security-headers.ts`, and asserted on served, refused and 404 responses in `apps/api/e2e/security/02-transport-and-limits.e2e.ts`.
One value differs from the sentence above and the difference is deliberate: the API's CSP is `default-src 'none'` rather than `'self'`, because it serves JSON and CSV and never a document, so the strictest policy is also the accurate one.
The list above read `Referrer-Policy: strict-origin-when-cross-origin` until issue #504 corrected it to the `no-referrer` all three surfaces actually send, which is what the two proxies have always sent.
The API does **not** emit HSTS: ADR-20 puts it at the operator's ingress, the only hop that terminates TLS, and `docker/Caddyfile` remains the single emitter.
The no-CORS assertion is now made against the API as well as the admin proxy.

**better-auth 1.7.2 accepts `Origin: null` when Fetch Metadata says the request is same-origin, and the Code Owner accepted that on 2026-09-01 (issue #757, from PR #740).**
Earlier versions refused a state-changing request whose `Origin` serialized as the literal `null` outright.
1.7.2 relaxes it: when `Sec-Fetch-Site: same-origin` accompanies the null origin, the library infers the origin from the request itself and validates the inferred value against `trustedOrigins` (`dist/api/middlewares/origin-check.mjs`, `validateOrigin`).
That is a live path here rather than a theoretical one, and for the reason the paragraph above already gives: `Referrer-Policy: no-referrer` makes a navigation POST serialize its `Origin` as `null`, so the admin's form posts arrive in exactly the shape this branch was written for.
It was accepted as a **compatibility fix, not a widened surface**, on three properties a reviewer can check rather than on the vendor's framing: the discriminator is `Sec-Fetch-Site`, which the browser sets and which a cross-site page cannot forge; `advanced.trustedProxyHeaders` is unset in `apps/api/src/features/auth/instance.ts`, so the inference reads the request's own host rather than a header a caller could steer; and `trustedOrigins` is `[adminAuth.baseUrl]`, the admin origin alone, so an inferred origin still has to equal the single origin QCMS trusts.
A request carrying neither a usable `Origin` nor that Fetch Metadata pair is still refused.
Recorded here because the vendor-pin gate (#483/#606) forces the version prose in this document to stay true but cannot see a **behaviour** change, which is the class this was.

## 6. Secrets management - SEC-8

All secrets arrive via environment (12-factor; adopters bring their secret manager - examples for Docker secrets and plain env documented).
The Zod config schema (017) validates presence _and shape_ (min lengths) at boot - fail fast, and **never echo values** in errors or logs (redaction test).
At-rest encryption for secrets we must read back (webhook secrets): AES-256-GCM under `QCMS_APP_KEY` via WebCrypto (fetch-pure), in a ciphertext format versioned by **scheme** (a `v1.` prefix marking the algorithm and envelope layout) and not by key, so it allows a future format upgrade but does not by itself enable key rotation - see the `QCMS_APP_KEY` note in section 4.
`.env.example` (037 scaffold) contains placeholders + generation commands (`openssl rand -base64 32`), never defaults that work - a deployment with placeholder secrets must refuse to boot.
Log hygiene: structured logger redacts known secret fields; **answer values are never logged** (respondent PII - log questionIds and counts, not content); tokens never appear in URLs (headers/cookies/body only - secure links are the sole, deliberate exception, mitigated by expiry + server-side state).

**The placeholder boot refusal now runs in all three processes, not only the API (issue #491).**
Task 040 built it in `apps/api/src/config.ts` alone and said so, deliberately, to keep that change out of the browser-gated app trees.
That left the portal and the admin accepting a placeholder `QCMS_INTERNAL_TOKEN` with a presence-only check.
It was not a hole in a composed deployment, because the strictest reader refuses and the stack does not come up at all; it was left standing because "the other guy validates it" is the reasoning that produced #401 and #402, and because a BFF started on its own would discover a published token as an authentication failure at the first request rather than as a refusal that names the variable.
Both apps now refuse at boot, from `instrumentation.ts`, beside the cookie-security refusal.
The vocabulary is a deliberate copy in each app (there is no shared package for a Next BFF's server code), so the agreement between the four readers - API, portal, admin and the committed-file gate `scripts/check-security-hygiene.mjs` - is enforced rather than conventional: `apps/api/src/config-placeholders.test.ts` pins the API against the gate and `scripts/check-bff-config-guards.test.ts` pins both apps against the same gate, from the repo root where no app's build cache can hide a drift.

**Stdout carries exception text, and the two log sinks are deliberately unequal (issue #489).**
"Redacts known secret fields" is a denylist over **field names**: `packages/observability/src/logger.ts` replaces any field whose key looks like a secret or like respondent content, and an `Error` is serialized to `{ name, message, stack }` **before** that name test is reached, so an exception's message and stack reach application logs verbatim.
The OTLP path does not inherit that.
Only string, number and boolean fields become exported attributes, and the shared allowlisting processor drops every attribute it does not name (SEC-13 §8a), so no exception content leaves the process; `packages/observability/src/logger-otlp-attributes.test.ts` pins the asymmetry in both directions.
The asymmetry is the intent rather than an oversight: stdout is read by an operator already inside the process boundary, while an exported record lands in an adopter's backend outside our erasure reach and retention controls.

**What that costs, stated rather than left implicit: treat application logs as potentially answer-bearing.**
No call site in QCMS logs answer content, and `pnpm check:security-hygiene` refuses one, so the "answer values are never logged" promise above holds for everything QCMS writes deliberately.
What it does not cover is content arriving _inside_ an error - a database driver error or a validation error whose message embeds the offending value would carry that value to stdout.
Not observed in practice; found by reading the redactor against this section's promise.
So an operator's retention, access control and shipping policy for application logs has to be the one they would give the database, and `docs/operations.md` says so where an operator will read it.
Whether to redact `message` and `stack` on the stdout path as the OTLP path already does, keeping the opaque `errorId` join, is a live option and a separate decision; it is recorded here as a decision rather than left as a silence.

## 7. Data protection

PII stance: **all answer content is treated as PII** regardless of question semantics - no classification guesswork.
Controls, all delivered by existing tasks: append-only ledger + version-pinned sessions (audit), retention sweep with TTL defaults (015), ADR-17 hard erasure + tombstone + reporting exclusion (016, 023, 035), extended by **059** so erasure also reaches QCMS's own retained copy of the answers - the session's `outbox.payload` is redacted in place (envelope kept, `answers` removed, `payload_redacted_at` stamped) and every undelivered `webhook_deliveries` row is terminally cancelled, enforced in the scheduler's claim query rather than in one handler, so a redacted payload has no path to the transport;
QCMS's own copy of the answers is also aged out for the ordinary case by the retention sweep once an event and its whole fan-out have settled past the redelivery window (`QCMS_OUTBOX_PAYLOAD_TTL_MS`, default 30 days - issue #329), so a response's second copy is no longer kept indefinitely merely because nobody filed an erasure request;
the residual limit is an in-flight request that cannot be recalled, documented in `docs/erasure.md`, backups documented with the honest note that erasure ages out of backups per the operator's retention (016 docs), reporting view consumed via a **read-only DB role** whose `CREATE ROLE` grant ships in the docs (015) - BI tools never get the app credential.
The API's DB user gets least privilege consistent with the erasure door (013/016): no superuser, no DDL beyond migrations.

**The app/migration role split is the shipped posture (issue #492, Code Owner decision of 2026-09-02).**
This paragraph used to say the application credential owned the schema and could issue DDL, and record the split as outstanding work in `docs/security-review-2026-08-14.md` §3.6.
It is now two roles, both of them least-privilege in the direction that matters.
**`qcms_app`** is the credential every API process runs as: `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the operational tables, `SELECT` on the reporting views, `USAGE` on the schemas and sequences, and beyond that nothing - no `CREATE` on `public`, no DDL of any kind, and not the schema owner, so the process serving respondent and authoring traffic cannot `DROP TABLE`.
**`qcms_migrate`** owns `public` and every object in it and holds the DDL rights `drizzle-kit migrate` needs; it is held by the one-shot migration step and by no process that serves traffic.
`DELETE` is granted whole rather than narrowed to the erasure and retention tables: that was considered as defence in depth over the `answers_reject_delete` trigger and rejected, because it multiplies the grants an operator has to get right and a missed one surfaces as a runtime failure rather than a boot failure.
The operator recipe - the role SQL, where each credential is set, the bootstrap ordering, and the one-time ownership handover for a database migrated under the old single credential - is the "Least-privilege database roles" section of `docs/operations.md`, shaped like the reporting recipe so it can be asserted the same way.
It is: `apps/api/e2e/security/03-db-least-privilege.e2e.ts` runs the recipe against a real Postgres, migrates as `qcms_migrate`, and asserts that `qcms_app` is refused every form of DDL, holds no `CREATE` on `public`, and owns nothing.
On Compose the recipe runs as a `db-roles` one-shot that `migrate` depends on, because a script in `/docker-entrypoint-initdb.d` runs only on an empty data directory and would silently skip every stack that already has data.

The reporting half of SEC-10 was implemented earlier and is unchanged: the read-only role recipe in `docs/reporting-view.md` is exercised against live Postgres and cannot read operational tables, write, or issue DDL.

**Exports are a delivery path back to the operator, so they carry a formula-injection guard (issue #470).**
A respondent's free-text answer reaches the form author as a cell in a file the product tells them to download and open in a spreadsheet, and several spreadsheet programs evaluate a cell whose first character is `=`, `+`, `-` or `@` (or a leading tab or CR before one of those).
Every CSV cell QCMS emits is therefore prefixed with an apostrophe when it starts with one, before RFC 4180 quoting.
The single exemption is a **plain decimal number** (`-?\d+(\.\d+)?`, whole-string): such a value contains no operator, function name or reference after its sign, so it cannot be evaluated as an expression, and prefixing it would export a negative numeric answer as text instead of a number (issue #476).
The exemption is deliberately narrow rather than a general "looks numeric" test, because `-1+1` also opens numeric-looking and evaluates to 0 in Excel; being too narrow costs a cosmetic apostrophe on an implausible value, being too wide ships a live formula.
Both exports (the response export in 023 and the minted-link batch export in 034) go through the single helper in `@qcms/csv`, so the guard and its exemption are identical on both: they previously carried a copy each, and the copies had diverged so that the guard sat only on the server-generated link fields and not on the respondent-controlled answers.
Cell contents remain export payload and are never logged (SEC-8).

## 8. Abuse resistance

Owned by 026 (rate limits, honeypot, min-time, session binding, challenge adapter) - see that task; this document adds the _placement_ rule: model-guarding protections live in the API, vendor-shaped challenges in the shell, absorption-scale defense (DDoS) at the ingress/CDN and explicitly on the operator.

**Every rate limit in this system is per-process, so N API replicas enforce N times the documented allowance (issue #488).** This section stated the placement rule and said nothing about replica count, which made every limit below quietly weaker than documented for any adopter who scaled horizontally - no setting changed, no warning emitted. Both per-address controls have the property, and until now only one of them was written down anywhere:

- **The respondent limiters** keep their tallies in `InMemoryRateLimitStore` (`apps/api/src/rate-limit.ts`), correctly described in its own comment as the single-process default, with a shared store as the adopter swap that task 017's `RateLimitStore` seam exists for. `docs/deploy-enterprise.md` §5 already says this of `api-public`.
- **The admin sign-in throttle** has the same property and was documented nowhere. better-auth resolves `rateLimit.storage` to `"memory"` unless a secondary storage is configured (better-auth 1.7.2, `dist/context/create-context.mjs:174`), and QCMS configures none, so each process that mounts `admin` keeps its own tally of SEC-1's three attempts per ten seconds per client address. Two such processes mean six attempts per ten seconds against an admin password.

Three answers, in the order they cost an adopter least: divide the configured maxima by the replica count; enforce the outer limit at the ingress, which is the one hop that sees all of the traffic; or implement `RateLimitStore` against a shared store (Redis, with real per-key TTLs). Whether QCMS should **ship** a shared store, and whether better-auth's limiter could be pointed at the same one through its `secondaryStorage` option, is a larger question that stays open and is not what this paragraph settles. The operator-facing statement of the same fact is in `docs/operations.md`.

**The client address a per-address limit keys on is an assertion, and the chain that produces it is a trust boundary (issues #341 and #374).**
Three hops, each vouching for the next: the **ingress** is the only component that sees the peer address and writes it into `X-Forwarded-For` (set, not appended, in the Caddy recipe, for both hostnames);
**the BFF that received the request** resolves one address from that header by counting its own trusted hops from the **right**, so entries a client wrote itself are never reached, and asserts the result on `X-QCMS-Client-Address`;
the **API** reads only that header and ignores `X-Forwarded-For` and `X-Real-IP` outright, because it never faces the internet (ADR-20) and the assertion rides the SEC-4 internal-token channel, so forging it presupposes the deployment's internal token.

The model covers **both** per-address controls, and the hop count is per app, because the two apps are two hostnames that may sit behind different ingresses: the portal resolves with `QCMS_PORTAL_TRUSTED_PROXY_HOPS` for the API's respondent limiters (#341), the admin with `QCMS_ADMIN_TRUSTED_PROXY_HOPS` for better-auth's per-IP sign-in throttling (#374).
The auth half is the one that was forgeable rather than merely coarse: the admin relayed the browser's own `X-Forwarded-For` to better-auth, whose default is to key on exactly that header, so rotating it bought an unlimited supply of fresh backoff allowances. better-auth is now pointed at the vouched header instead (`advanced.ipAddress.ipAddressHeaders`), which is pinned by driving the real library rather than by reading its configuration back (`apps/api/src/features/auth/sign-in-throttle.test.ts`).

Both failure directions are documented rather than hidden: with nothing vouched for, every caller shares one bucket (coarse, never a bucket per request - measured: better-auth answers the fourth unvouched sign-in attempt in ten seconds with a 429 whatever headers it carries); with more hops declared than exist, the resolver reads client-supplied text and per-address limiting is bypassable, which is why `docs/deploy-ingress.md` states the correct count per recipe.
The address is a bucket key and nothing else - never logged, never a span attribute (SEC-13 §8a), and persisted only as the `ipAddress` column of the admin `session` row better-auth writes at sign-in, which is a sign-in audit record.
040 owns verifying SEC-1 as a system.

**The shared-bucket direction costs availability, and it is the property of the default shape (issue #482).**
The paragraph above records that an unvouched caller falls into one bucket and calls it coarse.
On the shape this project ships as its default that is not a corner: `docker-compose.yml` puts no proxy in front of the admin, the production image runs `NODE_ENV=production` so better-auth's limiter is on, and with nothing vouched for its key is one constant.
The sign-in rule is three attempts per ten seconds, **shared**, so three attempts from any caller hold admin sign-in closed for every administrator until the window rolls, and a sustained caller holds it closed indefinitely; `/two-factor/*` has its own bucket with the same property.
This is fail-safe rather than fail-open - the failure is refusal, not admission - so it is an availability consequence rather than a hole in SEC-1, and the default topology does not change (ADR-20 keeps ingress operator infrastructure, so shipping a proxy container would be an ADR amendment rather than a Compose edit).
What changes is that the deployment now **says so**: the API logs a warning at every boot while the throttle is on and nothing declares a proxy in front of the admin, naming the consequence and the remedy (`apps/api/src/features/auth/instance.ts`), on the same every-boot precedent `QCMS_ADMIN_SIGNIN_THROTTLE=false` set.
The line reports a declaration and not an observation: the API never faces the internet, so it cannot see the admin's inbound chain and says as much rather than implying it checked.
Note the tension with issue #390 that this does not resolve - outside production the limiter is off entirely, and in the default production shape it is on but keyed on a constant.
The boot warning makes the second state visible; the first was already warned about.

**Agent-assisted authoring (ADR-25, flag-gated).**
The assist surface is admin-only (behind 2FA auth), off by default, and adds one egress path: outbound LLM-provider calls carrying **form structure only - respondent answers are structurally unreachable from the agent's tool surface** (the PII boundary is the allowlist, not a prompt).
Prompt injection is bounded the same way: the allowlist is enforced server-side (draft mutation + validation only; never publish/erase/links/webhooks), every proposal passes kernel validation, and publish remains a human act.
The provider key follows SEC-8 (validated iff the flag is on, never logged).
040 covers the surface when enabled.

## 8a. Telemetry privacy - SEC-13

**Telemetry is an export, so its contents are an allowlist, not a filter (ADR-34, tasks 054 and 062).** Spans and OTLP logs leave the process and land in an adopter's observability backend, which is outside our erasure reach and retention controls. Span attributes are reduced by the shared composition-root span processor. Before any OTLP log can be queued, a shared log processor replaces an unknown event body with `application.event` and drops every attribute not explicitly approved. This is independent of the stdout redactor: OTLP never relies on a field-name denylist to establish privacy.

**Never in any signal:** respondent answer values, direct identifiers (including names, email, phone and client address), `LocalizedText` content, secure-link tokens (`lnk_`), the SEC-4 internal service token, session bearers, admin credentials or TOTP material, and any other secret from the SEC-7 inventory.
Concretely: HTTP header capture is off; `enhancedDatabaseReporting` is off, so database telemetry never contains bound values; query strings are removed from URL-shaped span attributes; and exception messages and stacks are absent from both exported signals.
Errors remain joinable by opaque `errorId`, `requestId`, `trace_id` and `span_id` fields.

**This sentence used to claim application JSON logs too, and that was false (issue #489).**
The stdout redactor matches field names and serializes an `Error` to `{ name, message, stack }` before the name test, so exception text does reach stdout.
It is deliberate and it is recorded in §6, which also records what it costs an operator.
SEC-13 governs what is **exported**, and nothing changes there: an OTLP log record takes only scalar attributes off an allowlist, so no exception content crosses that boundary.
The correction is kept in place rather than deleted because a control claimed of two sinks and present in one is the pattern this document keeps finding (compare #470, #401, #402, #471, #487).

**Branded ids are permitted as pseudonymous correlators** (`frm_`, `stp_`, `q_`, `ses_`): they are random and opaque, they carry no respondent content, and they are what makes an exported trace worth reading. The **secure-link token is the deliberate exception that needs work**, because it is a credential in a URL path (`/l/<token>`, the SEC-8 exception noted in §6): the portal redacts it to `/l/[token]` in URL attributes _and in the span name_, since Next builds its root span name from the real pathname.

**The adopter owns telemetry retention.**
Tracing is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and when it is set the `ses_` ids in the exported spans live in the adopter's backend under the adopter's retention policy - the ADR-17 erasure path governs QCMS's Postgres only and cannot reach them.
That is documented rather than hidden, and it is why the ids are pseudonymous by construction: an erasure request that has removed the answers leaves behind, at most, opaque identifiers in an operational store the operator chose to fill.
Hashing ids at the exporter was considered and deferred (Phase 4) as unnecessary given the above.

**Verified by:** unit tests over the span, log and stdout controls (unknown attributes dropped, URL query stripped, exception content gone from the exported record, direct identifiers masked, token rewritten) plus traced e2e runs for Portal and Admin. The respondent test submits a known answer value through the real stack and asserts it appears in **no** captured OTLP payload or server log; both tests require BFF and API records to share a trace and request id.

## 9. Supply chain and release security - SEC-11

Lockfile committed and frozen in CI (`--frozen-lockfile`); `pnpm audit` in CI (fail on high/critical with a documented triage path); Dependabot enabled for `github-actions` and `npm`; minimal dependency policy (the 010 decision to hand-roll tokens over a JWT lib is the pattern).
Vendored `a2-react-aria` component sources (ADR-22) enter the repo via `@a2ra/cli add` and are reviewed in their PR like any first-party code - no postinstall scripts, no opaque bundles. npm publishing: 2FA on the npm account, provenance attestations (`npm publish --provenance`) for all `@qcms/*` packages, publish only from CI on tagged releases.
Docker images: pinned base digests (#372), non-root, SBOM (036).

**Corrected 2026-08-14 (task 040, against issue #372).**
Two claims in this paragraph were false and are removed above rather than left standing. **osv-scanner runs nowhere**: `.github/workflows/audit.yml` runs `pnpm audit` and the string `osv-scanner` appears nowhere in `.github/`.
**Base digests were not pinned**: all six `FROM` lines in `docker/{admin,api,portal}.Dockerfile` were floating tags, and `.github/dependabot.yml` had no `docker` ecosystem, which is the coverage pinning depends on.
"non-root" and "SBOM" are true.
The Code Owner ruled this is not a 1.0 blocker, that pinning and the Dependabot container coverage must land together, **and that 040 is the natural home for the work** ("doing it there means we measure before and after").
**040 declined that assigned home and recorded the deviation** rather than quoting only the clause that excuses it: the scanners are single-binary installs, so this was a scope choice and not a tooling blocker.
The full ruling, the reasons and the recorded before-state are in `docs/security-review-2026-08-14.md` §6.2.

**The pinning half closed on 2026-09-02 (#372), and the paragraph above is left standing because it is the record of what was true before it.**
Each of the six `FROM` lines now carries its digest **beside the tag** (`node:24-bookworm-slim@sha256:...`), so a reader can still see what the image is, and `.github/dependabot.yml` gained a `docker` ecosystem for `docker/` plus a `docker-compose` ecosystem for the committed Compose files.
The two landed in one change on purpose: Dependabot moves a tag and its digest together once a digest is present, but will not write the first one, so a pin with no updater is a base image that ages quietly - worse than the floating tag it replaced, which at least picked up Debian patches on every rebuild.
Reach and limits are recorded beside the entries themselves: `FROM ${ARG}` is unsupported upstream, so `docker/lgtm.Dockerfile` and `docker/seed.Dockerfile` stay untracked by design.
**The claim that stood in this sentence about Compose was false and is corrected (2026-09-03, issue #787).**
It said a `${VAR:-image:tag}` reference is not resolved and that `docker-compose.dev.yml`'s literal was therefore the only Compose image covered; PR #776 moved four references across three Compose files, three of them written in the variable-default form, so Dependabot reads through `${VAR:-...}` and rewrites the default.
Every image reference in the committed Compose files is in reach.
The real limit is a different one: that tag also lives in the Testcontainers harness default, the #74 mirror workflow, the environment reference and the documentation, so a Compose-only bump splits the pin rather than moving it.
**Both container ecosystems are now bounded to non-major updates** (`version-update:semver-major` ignored on each), because the first PR from each was an unwanted major: #776's Postgres 16 to 18 is not an in-place upgrade for an existing volume, and #777's Node 24 to 26 was red on arrival, since Node 26 images no longer ship the corepack all three Dockerfiles enable.
Majors are done deliberately now; digest refreshes, the security-relevant half, still arrive weekly.
**What has not changed: there is still no container-image vulnerability scanning of any kind**, so what a different base would buy remains unmeasured, and the "measure before and after" half of the ruling is still open.
The scaffold (037) must never contain a real secret - a scaffold-output scan is part of its CI.
GitHub: branch protection, required CI, no force-push to main.

## 10. Assurance plan and traceability - SEC-12

**Continuous (every stage):** security-relevant exit criteria already embedded in tasks - the matrix below is the audit trail.
**Pre-launch:** task **040** runs a structured security review (checklist from this document: authn/authz matrix enforcement tests, header/cookie/CSRF verification, secrets redaction, dependency and scaffold scans, an OWASP ASVS L2-oriented pass over the API) and fixes or tickets findings; launch (038) requires zero open high-severity findings.
The 2026-08-14 pass is recorded in `docs/security-review-2026-08-14.md`, which names its own input set, its severities, and what it could not verify.
**Post-launch:** `SECURITY.md` in the repo (vulnerability disclosure: private reporting via GitHub security advisories, response-time commitment, supported-versions table); security patches released as patch versions with advisories; adopter notification via release notes + advisory.

| Control                                          | Designed | Delivered / verified                                                                                                                |
| ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Admin authn + 2FA (SEC-1)                        | §2.1     | 031 · #178 · #390 · 040                                                                                                             |
| Respondent tokens + secure links (SEC-2)         | §2.2     | 010, 018, 024 · 027                                                                                                                 |
| Authorization matrix (SEC-3)                     | §3       | 017, 021–023 · **040 matrix tests (`apps/api/e2e/security/`)**                                                                      |
| Service channel auth (SEC-4)                     | §2.3     | 017, 029, 031 · 040                                                                                                                 |
| `/api/v1` scopes (SEC-5, reserved)               | §2.4     | route annotations in 021–024 · Phase 4 (039)                                                                                        |
| Webhook signing + secret handling (SEC-6)        | §2.5     | 024, 025 · 027                                                                                                                      |
| Key inventory + rotation (SEC-7)                 | §4       | 010, 017, 024, 036 runbooks · 040                                                                                                   |
| Secrets handling + redaction (SEC-8)             | §6       | 017, 037 · **040 (placeholder boot refusal + `check:security-hygiene`)** · #491 (both BFFs) · #489 (stdout exception text recorded) |
| Transport/browser hardening (SEC-9)              | §5       | 029, 031, 036 · **040 (API headers, #471)**                                                                                         |
| Least-privilege DB roles (SEC-10)                | §7       | 013, 015 · 040 (reporting role asserted) · **#492 (app/migration split shipped and asserted)**                                      |
| Supply chain (SEC-11)                            | §9       | 001 (CI), 036, 037 · #372 (base digests + Dependabot containers) · **image scan still not run**                                     |
| Review + disclosure (SEC-12)                     | §10      | **040 (`docs/security-review-2026-08-14.md`, `SECURITY.md`)**, 038 gate                                                             |
| Telemetry privacy / redaction allowlist (SEC-13) | §8a      | 054, 062 · **not re-verified by 040**                                                                                               |

**Consistency notes against existing docs:** `ARCHITECTURE.md` §5.1's table gains the internal service token implicitly (SEC-4) - no contradiction; 017's config schema grows `QCMS_SESSION_KEYS`, `QCMS_INTERNAL_TOKEN`, `QCMS_APP_KEY` and 010 generalizes to purpose-tagged tokens - **task files 010/017/018 were corrected in place (2026-07-19)** per the staleness rule (`AGENTIC_DEVELOPMENT.md` §1.1); 018's session token is ratified as SEC-2. If a conflict between a task file and this document is discovered later, this document wins and the task file is corrected in the same change.
