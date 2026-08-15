# QCMS pre-launch security review, 2026-08-14

**Status:** evidence, not a sign-off. The 040 security review is a **Code Owner
gate**; this document is the material that gate reads. Nothing here declares the
review passed.
**Executed by:** task 040 (`docs/features/040-security-review-hardening.md`),
which runs the assurance plan in `docs/SECURITY_DESIGN.md` §10 (SEC-12).
**Tree reviewed:** branch `feat/040-security-review-hardening`, based on
`origin/main` at `fbc674f`.

**On the base, and why this is a restatement rather than a re-verification
(`CONTRIBUTING.md`'s rebase rule).** The review was originally performed against
`c5748a4` and the branch has since been rebased twice. The intervening `main`
commits were diffed and none touches a control this document asserts on: they
add `packages/csv` and its consumers, an `apps/admin` change and lockfile
movement, with no change to the API's auth middleware, config parsing, token
handling, webhook signing, headers or database roles. The executable evidence is
independent of that argument in any case, because every suite cited here was
re-run on the rebased tree rather than carried across.
**Supersedes nothing.** The next review supersedes this one by date.

---

## 1. What was reviewed, and how

**Scope.** The API surface (`apps/api`), the two BFF apps' security-relevant
seams, `packages/db`'s role and query surface, the shipped Compose and Docker
artefacts, the committed example environment files, and the dependency tree.

**Method.** Four passes, in this order:

1. **Re-derived triage.** The open `security`-labelled issues were listed at run
   time and triaged here, from the code rather than from the issue text. The set
   and its date are recorded in §2.
2. **Composition-level probes.** New executable suites under
   `apps/api/e2e/security/` assert the SEC-3 authorization matrix, the SEC-9
   transport controls, the SEC-6 signing contract and the SEC-10 role recipe
   against a running composition. Per-slice unit tests were treated as evidence
   about a slice, never about the system.
3. **ASVS L2-oriented walk** of the API surface (§5).
4. **Supply-chain and image pass** (§6), which is the pass with the largest
   evidence gap and says so.

**Two disciplines applied to every new assertion**, because the project has been
bitten by their absence before: each new guard was **seen red** by removing the
predicate behind it and observing which tests failed (the removals and their
results are recorded inline in §3), and every negative case is preceded by a
**positive control** proving the fixture is real. A test run that reports zero
executed tests was not accepted as a red.

**The tree that was reviewed is this repository**, not the `create-qcms-app`
generated tree. PR #451 vendors `apps/admin`, `apps/portal` and `docker/` into
`packages/create-qcms-app/templates/` and is not merged. When it merges, the
artefact an adopter runs becomes a second copy of this security surface, kept
equal by `pnpm check:templates` alone. **That gate becomes a security control on
the day 037 lands**, and this review has not exercised it.

---

## 2. The input set: open `security` issues at 2026-08-14

`gh issue list -R roonga/qcms --label security --state open`, run 2026-08-14.
Twelve rows: eleven findings plus **#361**, which is the blocker tracker rather
than a finding. Severity below is this review's own, re-derived from the code.

| Issue | One line | Severity (this review) | State at close of review |
|---|---|---|---|
| #470 | Response CSV export has no formula-injection guard | **HIGH** | **Open.** Fix in flight on PR #480; not on `main` |
| #390 | better-auth sign-in throttle is off unless `NODE_ENV=production`, with no boot signal | **HIGH** | **Open.** Needs a Code Owner ruling; three options on the issue |
| #432 | No 2FA reset, so a leaked `QCMS_ADMIN_AUTH_SECRET` version can never be retired | MEDIUM (downgraded, see §3.3) | Open |
| #453 | SEC-6/SEC-7 promised a webhook dual-signing window that does not exist | MEDIUM | **Documentation half closed**; the product question is open. Behaviour now asserted (§3.5) |
| #401 | `QCMS_SECURE_COOKIES` parses leniently in the portal, strictly in the admin | MEDIUM | Open |
| #372 | Base images unpinned, no Dependabot docker coverage, no image scanning | MEDIUM | Open, **and not closed by this task** (§6) |
| #471 | SEC-9 marks API security headers delivered by 017; the API set none | MEDIUM | **Fixed in this task** (§3.4) |
| #478 | `POST /admin/links/{linkId}/revoke` trusts a client-supplied id with no form scope | MEDIUM | Open; claimed on `fix/478-revoke-form-scope` |
| #482 | On the default Compose shape every admin shares one sign-in throttle bucket | MEDIUM | Open |
| #402 | The API is a third reader of the secure-cookie rule with no loopback guard | LOW | Open |
| #444 | `pnpm audit` findings (scheduled) | LOW | **Recommend closing**: no longer reproduces (§6.1) |
| #361 | Tracker: 1.0 blocker, "task 040 security review" | n/a | See §8 |

**Two findings in this review have no issue at all.** Neither could have been
found from the issue list, which is the structural point #361 makes:

| Finding | Severity | State |
|---|---|---|
| **F1.** Every shipped example environment file fills its signing, channel and at-rest keys with placeholders long enough to pass validation, so a half-configured deployment boots on published key material | **HIGH** | **Fixed in this task** (§3.1) |
| **F2.** SEC-10's app/migration role split does not exist in code or in the documentation it points at, and the reporting-role recipe had never been executed | MEDIUM | Partly closed: recipe now executed and asserted; the split is recorded as absent (§3.6) |

**Severity scale used.** HIGH: an absent control on an attacker-reachable path,
or a control the security design lists as delivered that is absent under a
configuration an operator can reach without being told. MEDIUM: a control that is
coarse rather than absent, a documented-versus-shipped divergence with no live
exposure, or a latent gap that grants an attacker nothing today. LOW: a
correctness or clarity defect in a security-relevant artefact with no reachable
consequence. Severity answers "what does an attacker get", not "how embarrassing
is it".

---

## 3. Findings in detail

### 3.1 F1 (HIGH, fixed here): placeholder secrets booted

`docs/SECURITY_DESIGN.md` §6 states that "a deployment with placeholder secrets
must refuse to boot". Nothing enforced it. Config validation was a length floor
(`MIN_SECRET_LENGTH = 32`), and every placeholder the repository ships is longer
than that:

```
QCMS_LINK_KEYS=replace-with-a-random-32-character-link-signing-key
QCMS_SESSION_KEYS=replace-with-a-random-32-character-session-signing-key
QCMS_INTERNAL_TOKEN=replace-with-a-random-32-character-internal-token
QCMS_APP_KEY=replace-with-a-random-32-character-app-encryption-key
QCMS_ADMIN_AUTH_SECRET=replace-with-a-random-32-character-admin-auth-secret
```

**What an attacker gets.** An operator who copies `.env.compose.example`, sets
the database password and the two base URLs, and does not reach the key lines
gets a deployment that boots and serves. Its session-token and secure-link
signing keys, its SEC-4 channel token and its at-rest encryption key are then all
published in a public repository. That is session forgery, secure-link forgery,
direct access to the internal API surface, and decryption of every stored webhook
secret, against a deployment whose operator has no signal that anything is wrong.
This is the highest-impact finding in the review and no issue tracked it.

**Fixed** in `apps/api/src/config.ts`: `rejectPlaceholders` refuses any secret
value whose lower-cased form starts with a known placeholder prefix, at every
secret-bearing parser (`parseKeyList`, `parseRequiredString`,
`parseSecretVersions`). Prefixes rather than exact strings, so the guard survives
a reword of the example files. The refusal names the variable and never the
value (SEC-8).

**Evidence.** `apps/api/src/config-placeholders.test.ts`, whose fixtures are the
literal values from the committed example files. Red-proof: neutralising the
predicate inside `rejectPlaceholders` turned exactly the ten refusal assertions
red and left the two positive controls green (12 tests executed, 10 failed).

**Corroboration the finding was real, found by fixing it.** With the guard in
place the full-stack Compose harness stopped booting, because
`scripts/compose-e2e.mjs` passes `--env-file .env.compose.example` verbatim: the
suite that exists to exercise the shipped stack was standing one up on the
repository's published key material. The harness now generates ephemeral hex
secrets per run and overrides the example's placeholders through the shell
environment, which Compose prefers over the env file. That is the strongest
available evidence that the placeholders were reachable in practice and not only
in principle.

**Complementary gate.** `scripts/check-security-hygiene.mjs` refuses a live-
looking value in a committed `.env*.example`. The two halves point in opposite
directions on purpose: the config guard stops a placeholder reaching production,
the gate stops a real secret reaching the repository.

**Residual, stated.** The guard is in the API only. The portal and admin read
`QCMS_INTERNAL_TOKEN` through their own config modules and still accept a
placeholder there. That is not a hole: with the API refusing, the deployment does
not come up at all. Extending it to the two apps was left out deliberately to
keep this change out of the browser-gated app trees; it is worth a follow-up.

### 3.2 #470 (HIGH, open): CSV formula injection in the response export

Confirmed present on `main`: `apps/api/src/features/responses/admin/csv.ts`
performs RFC 4180 quoting and no leading-character guard, while
`apps/admin/lib/forms/links.ts` carries the guard on an export whose content is
server-generated and structurally safe. Attacker-controlled free text from a
public, anonymously-startable form reaches the unguarded one.

**Not fixed here, deliberately.** PR #480 (issue #470) implements it via a shared
`@qcms/csv` helper and was still open at the close of this review. Adding a second
copy of the guard is exactly the defect that produced the finding, so this review
records it and does not touch it. **Criterion 3 cannot be met until #480 merges.**

### 3.3 #432 (downgraded to MEDIUM): no 2FA reset, no auth-key retirement

The gap is confirmed: no `reset-2fa` path exists in any form, and
`docs/SECURITY_DESIGN.md` §4 records why a TOTP secret written under one key
version never migrates forward, so a version can never be retired.

**This review downgrades it from the incoming triage's HIGH, and records the
disagreement rather than settling it silently, as that triage asked.** The
reasoning is consistency with how the same question was answered for #305:
severity is what an attacker gets. The confidentiality harm here is conditional
on an attacker already holding **both** a database read and the auth secret, and
an attacker holding both already has complete admin access. What the gap removes
is the **defender's** ability to remediate afterwards: a rotation the runbook
describes does not revoke second factors that were enrolled before it. That is a
serious incident-response gap and a genuine blocker for SEC-7 key-list pruning,
and it grants an attacker nothing they do not already hold.

**The availability half is worse than this review first stated, and the
correction matters to the severity.** An earlier draft said the lockout "requires
losing both the TOTP device and the recovery codes, which are regenerable". That
understates it, because **regeneration presumes the sign-in that has been lost**:
`apps/admin/app/(shell)/settings/recovery-codes/route.ts` requires
`requireAdminSessionForRequest()` *and* the account password, so it is reachable
only by an admin who can already complete a 2FA challenge. Checked against the
tree rather than inferred, the position today is that **no recovery path exists
at all**: the read-back route `POST /admin/auth/recovery-codes` was removed by
#319, `two-factor/disable` is deliberately absent from `ALLOWED_AUTH_ENDPOINTS`,
and `qcms:create-admin` refuses once any admin exists. #319's own text asked that
it not land before a break-glass existed; it landed on 2026-08-13 and nothing
replaced what it closed. So an operator who loses both factors is locked out
permanently, with no documented or coded way back.

That does not change this review's reasoning about the *confidentiality* half,
which is what the severity scale keys on and which still grants an attacker
nothing they do not already hold. It does strengthen the case for the Code Owner
reading the finding high on operational grounds, which this section already
invites them to do, and it is the sharper argument for fixing it before any
deployment carries real respondent data.

**Recommendation:** treat as MEDIUM, fix before any deployment handles real
respondent data at scale, and keep it as the named prerequisite for retiring an
auth-secret version. If the Code Owner reads the remediation gap as high, that is
a legitimate reading and it changes criterion 3's answer.

### 3.4 #471 (MEDIUM, fixed here): the API set no security headers

Confirmed by absence and then by runtime: before this change a composed API
returned no CSP, no `X-Content-Type-Options`, no `Referrer-Policy` and no
frame-ancestors directive, while `docs/SECURITY_DESIGN.md` §5 listed all four for
"both Next apps + API" and marked them delivered by 017.

**Fixed** in `apps/api/src/middleware/security-headers.ts`, installed above the
mounted groups so refusals carry them too. `default-src 'none'` rather than
`'self'`: the API serves JSON and CSV and never a document, so the strictest
policy is also the accurate one. HSTS is deliberately **not** emitted: SEC-9 and
ADR-20 put it at the operator's ingress, which is the only hop that terminates
TLS, and `docker/Caddyfile` remains the single emitter.

**Live exposure closed: small.** The API container publishes no port and no
ingress recipe routes it, so in a stock deployment no browser sees these
responses. The reason to fix rather than to walk the document back is that this
was the third instance in one triage of the security design asserting an API-side
control that did not exist, each justified after the fact by topology. A claim a
reader cannot check is the defect.

**Evidence.** `apps/api/e2e/security/02-transport-and-limits.e2e.ts` asserts each
header on a served response, an unauthenticated refusal, a 404 and a served
respondent call.

### 3.5 #453 (MEDIUM): webhook dual-signing, verified as absent

`docs/SECURITY_DESIGN.md` §2.5/§4 and `docs/webhooks.md` have all been corrected
to say what ships: one signature per delivery, `v1=` is a scheme version and not
a key id, re-issuing a secret is a **hard cutover**. This review verified the
corrected description rather than the withdrawn one, which is what the amended
task file (2026-08-13) asks for.

Asserted end to end in `02-transport-and-limits.e2e.ts`: a real delivery carries
exactly one `X-QCMS-Signature` with one `v1=` value and no comma list; the
documented consumer recipe accepts it; tampered body, tampered timestamp,
tampered signature and a foreign secret are all rejected; a byte-identical replay
outside the five-minute bound is rejected on the timestamp alone; and after a
rotation the new secret verifies while the old one does not, with no second
header. **The recovery sequence (re-issue, hand over, redeliver) is therefore
the only one available, and it is documented.**

Writing the consumer recipe from `docs/webhooks.md` and running it also
established a wire-format fact the document leaves implicit and this review had
initially got wrong: `X-QCMS-Timestamp` is **unix seconds as a decimal string**,
not an ISO instant. The suite now pins that shape.

**Open:** whether to build the overlap window at all. That is a product decision,
not a documentation one.

### 3.6 F2 / SEC-10 (MEDIUM, partly closed): least-privilege database roles

The incoming triage recorded SEC-10 as "not inspected at all". Inspected now, and
the blind spot was warranted:

- The **reporting role** exists only as a fenced SQL sample in
  `docs/reporting-view.md`. No migration creates it. Nothing had ever run it.
- The **app/migration role split** that `docs/SECURITY_DESIGN.md` §7 attributes
  to "036 documents the split" does not exist: `docs/features/036-*.md` contains
  no role, grant or privilege text, `docs/deploy-enterprise.md` runs the
  migration step with the same credential as the app, and no migration creates
  any role. The credential the API runs as owns the schema and can issue DDL.
- The only role SQL that ships anywhere is `qcms_ro` in
  `docker-compose.dev-tools.yml`, for the local database viewer.

**Closed here:** the documented reporting recipe is now executed against a real
Postgres and its claims asserted (`apps/api/e2e/security/03-db-least-privilege.e2e.ts`):
the role reads both reporting views, cannot read `answers`, `sessions`,
`webhooks`, `secure_links` or `form_versions`, cannot write through the views or
to an operational table, cannot issue DDL of any kind, and holds no `CREATE` on
`public`. That recipe is a control now rather than a document.

**Not closed:** the app/migration split. Choosing the grants an operator must run
is an operator-surface decision with a documentation deliverable attached, not a
test fixture, so this review records the state rather than inventing a policy.
The suite pins the current situation so that the day a split ships, the file goes
red and gets updated instead of quietly describing the old world.

`docs/SECURITY_DESIGN.md` §7's "036 documents the split" is corrected in this
change under the staleness rule.

### 3.7 #390 / #482 (HIGH / MEDIUM, open): sign-in throttling

Re-confirmed from source: `apps/api/src/features/auth/instance.ts` configures
better-auth with **no `rateLimit` key**, so the vendor default
`enabled: options.rateLimit?.enabled ?? isProduction` applies, and `isProduction`
is `NODE_ENV === "production"` captured at module load. The three shipped
Dockerfiles set `ENV NODE_ENV=production`, so a stock Compose deployment is
throttled. Any deployment running the API outside those images is not, and
nothing tells the operator: `apps/api/src/main.ts` logs `port`, `mount` and
`tracing` at boot and nothing about abuse controls.

**Why still high.** SEC-1 lists per-account and per-IP exponential backoff as
delivered. Under a reachable configuration it is absent, silently, on the
credential that reads every respondent's answers. The shadcn-style distribution
model makes "the adopter runs the shell their way" the ordinary case, not the
exotic one.

**Not fixed here, and this is a scope judgement worth being explicit about.** The
issue enumerates three options and they trade differently for a solo developer, a
CI environment and a production deployment; picking one is a Code Owner decision,
not an implementation detail. Turning it on unconditionally throttles every
developer through one bucket, which is #482's finding pointed the other way.

**Recommendation that needs no ruling** and would remove the "silently" from this
finding: one boot log line naming whether the sign-in throttle is active, and the
resolved trusted-proxy hop count for the process. It logs configuration, not an
address, so SEC-13 is untouched. This is the only in-process detection surface
the design admits, and it also answers the residual in `docs/SECURITY_DESIGN.md`
§8 (a hop count higher than the real proxy count is undetectable from inside).
Left as a recommendation rather than done here because `main.ts` is outside this
change's footprint.

### 3.8 Rate limits are per-process, and no document says so

`apps/api/src/rate-limit.ts` is an in-memory fixed-window store, correctly
described in its own comment as "the single-process default". better-auth's
throttle store has the same property. `docs/SECURITY_DESIGN.md` §8 says nothing
about replica count, so **every documented limit silently multiplies by the
number of API replicas**. An adopter who scales horizontally weakens every abuse
control without touching a setting. Recorded here; recommended as a one-paragraph
addition to §8 and a note in `docs/operations.md`.

### 3.9 Twin asymmetry as a search pattern

The incoming triage recommended treating "a control present in one app and absent
in its twin" as a pattern rather than a one-off. Applied, and it holds: #470 (CSV
guard in the admin export, absent from the API export), #401 (two different
boolean parsers), #402 (two of three readers guarded), #471 (headers in both
proxies, absent from the API). All four are the same shape. The two closed in
this change (#471, F1) were both found by asking "who else reads this?" rather
than by reading an issue.

---

## 4. SEC-1 to SEC-13 traceability

Verdicts are about **this tree**, on the evidence named. "Verified" means an
executable assertion exists and was seen to run.

| Control | Verdict | Evidence and deviations |
|---|---|---|
| **SEC-1** admin authn + 2FA | **Verified with a deviation** | No self-registration in either process shape, asserted in `01-authorization-matrix.e2e.ts` (`sign-up/email` is 404 and the refusal names no endpoint). Session expiry, 12h absolute lifetime and the 2FA-required condition all refuse on every admin surface. Breach-corpus check present. **Deviation: sign-in throttling is off unless `NODE_ENV=production` (#390), and recovery codes are stored encrypted rather than hashed (recorded in §2.1 of the design, deviation from NIST SP 800-63B / ASVS).** |
| **SEC-2** respondent tokens + links | **Verified** | Purpose claims are not interchangeable in either direction; a session token authorizes exactly one session; tampered claims, tampered signature, expired and malformed bearers all 401 with no oracle; the API sets no cookie, so the credential never leaves the BFF's control. |
| **SEC-3** authorization matrix | **Verified** | `01-authorization-matrix.e2e.ts` walks every §3.2 row under no credential, wrong channel credential, channel credential alone, four bad admin-session shapes and another respondent's bearer, plus the ADR-09 404-not-403 property in a public-only process. **One observation against the table, not a defect: see §7.** |
| **SEC-4** service channel auth | **Verified** | Every gated surface refuses a missing, empty and wrong internal token; the token alone grants no identity-bearing action. |
| **SEC-5** `/api/v1` scopes | **Reserved, unbuilt** | Scope annotations present as OpenAPI metadata and inert at launch, which is what the design says. Not exercised. |
| **SEC-6** webhook signing | **Verified** | §3.5. One signature per delivery, documented recipe accepts it, four tamper classes and a replay rejected, hard cutover asserted, secret never appears in a listing. |
| **SEC-7** key inventory + rotation | **Verified in part** | Rotation overlap is now asserted as a running process, not as a config-parser property: a third composition over the same database, with a fresh key at the head of each of the three lists and the original retained behind it, still accepts the demoted internal token, a session token signed under the demoted session key, and a secure link signed under the demoted link key. The discriminator that makes those mean something is also asserted: a token minted by the rotated process does **not** verify on the un-rotated one, so the head entry genuinely signs. A key on neither list is refused. **Not verified: retiring an admin auth-secret version, which the design itself records as impossible at launch (#432).** |
| **SEC-8** secrets + redaction | **Verified, with a control added** | Placeholder secrets now refuse boot (§3.1). Config refusals name variables and never values, asserted. Refusals carry no stack, no file path and no token. A CI gate now refuses any logging call site that passes answer-shaped content and any live-looking value in an example env file. |
| **SEC-9** transport/browser | **Verified, with a control added** | §3.4. Headers on served, refused and 404 responses; no CORS header on any response or preflight; body cap enforced at 413 **before** the credential gate. **Deviation: HSTS is emitted only by the ingress, by design.** |
| **SEC-10** least-privilege DB roles | **Partly verified, gap recorded** | §3.6. Reporting recipe executed and asserted. App/migration split absent in code and in the docs §7 points at. |
| **SEC-11** supply chain | **Partly verified, largest evidence gap** | §6. `pnpm audit` clean. Lockfile deduped. **Image scanning was not run (not attempted; the scanners are single-binary installs, so this is a choice, not a blocker - see §6.2). Base digests remain unpinned (#372). Provenance publishing is unverifiable: nothing is published (#360).** |
| **SEC-12** review + disclosure | **This document, plus `SECURITY.md`** | §8. |
| **SEC-13** telemetry privacy | **Not re-verified here** | Covered by task 054/062's own suites (span/log allowlist, traced e2e asserting a known answer value appears in no captured payload). This review did not re-run them and did not probe the failure mode noted below. |

**SEC-13 note carried forward, not closed.** The OTLP log allowlist is an
exact-string set of known message values; an unrecognised message has its body
replaced with `application.event`. That is the right fail direction for privacy
and a silent one for observability. Two retention-sweep messages
(`"delivery response snippets redacted"`, `"outbox payload answers redacted"`)
are not in the allowlist and therefore export as `application.event` today. Worth
an issue; not a privacy finding.

---

## 5. ASVS L2-oriented pass over the API surface

Recorded at **chapter level rather than by requirement number**, deliberately:
ASVS 4.0.3 and 5.0 number these differently and this document should cite what
was checked, not invent identifiers.

**Authentication.** Credentials are never accepted on a public mount that does
not carry the identity provider (404, not 403). No self-registration path is
reachable over HTTP in any composition. Failure responses do not distinguish an
unknown token from an expired one (asserted byte-for-byte). Passwords are checked
against the breach corpus, fail-closed, with a documented offline knob. **Gap:
brute-force throttling is configuration-dependent (#390).**

**Session management.** Respondent tokens are stateless HMAC with a purpose claim
inside the MAC and a separate key list per purpose; server-side state is required
in addition for secure links. Admin sessions are server-side rows with both an
idle expiry and a 12h absolute cap, enforced at the gate and asserted. Respondent
tokens are never set as cookies by the API: `POST /sessions` returns the token in
the body and emits no `Set-Cookie`, asserted here, so the portal BFF is the only
thing that ever chooses a cookie flag for a respondent. The one place the API
does emit `Set-Cookie` is the better-auth mount, and the admin BFF re-emits those
headers verbatim onto its own origin, whose flags its own suites assert.
Sign-out and password change revoke server-side.

**Access control.** Enforced in the API layer, never in a BFF and never only in
the UI. Deny-by-default at two levels: an unmounted group does not exist, and a
mounted group is gated before any handler. Object-level checks are present on
respondent routes (token binds one session id, path must match) and, since #305,
on the form-scoped admin routes; cross-form read, erase and unflag are asserted to
404 in this review. **Gap: `POST /admin/links/{linkId}/revoke` still takes a bare
link id (#478), which grants nothing under a single role but is the same latent
shape #305 closed elsewhere.**

**Validation.** Every route body and query is a Zod schema at the boundary
(`@hono/zod-openapi`), so an unvalidated field cannot reach a handler. Request
bodies are capped at 1 MB and the cap is applied **before** the credential gate,
so an unauthenticated flood is cheap to refuse. Answer values are validated by the
kernel against the published question definition, not by the transport.

**Injection.** No `sql.raw` and no string-built SQL exists anywhere in the tree;
every `sql` template is Drizzle's tagged form, which binds its interpolations.
JSONB answer values are only ever bound. That finding is from reading the tree.
The **standing** part of it is a CI gate
(`scripts/check-security-hygiene.mjs`), which covers `sql.raw`, a bare
interpolated template passed to `execute`/`query`, and `+` concatenation
adjacent to a quoted literal there - **but not** a statement assembled elsewhere
and passed by variable, which needs data-flow analysis. So the finding is
broader than the guard that preserves it, and the guard says so itself. **Gap: CSV formula injection
in the response export (#470), which is an injection into the operator's
spreadsheet rather than into the database.**

**Error handling and logging.** One envelope for every failure; unhandled errors
return an opaque `errorId` with the stack logged and never returned, asserted here
against stack frames, `node_modules` paths and the internal token. Answer values
are never logged, redacted by field name on stdout and by allowlist on OTLP, and
now additionally refused at the call site by CI. **Residual: `Error.message` and
`Error.stack` are not redacted on the stdout path, so a database or validation
error whose message happens to embed an answer value would reach stdout. Not
observed; recorded as a hardening candidate.**

**Cryptography.** WebCrypto only (R4). HMAC-SHA256 for tokens and webhook
signatures, AES-256-GCM for at-rest webhook secrets under a scheme-versioned
envelope. Key lengths validated at boot in characters, which is now stated in the
unit the code enforces rather than in bytes (a wording defect corrected here).

---

## 6. Dependency and image pass

### 6.1 Dependencies

`pnpm audit` on this tree: **0 vulnerabilities** across 821 resolved
dependencies (info 0, low 0, moderate 0, high 0, critical 0).

**#444 no longer reproduces.** Both advisories it reported are gone from the
lockfile, verified by resolution and not by the audit summary alone: the only
`brace-expansion` 5.x resolution is `5.0.9` and the only `nanoid` 3.x resolution
is `3.3.18`. The two premise defects that issue exposed in `CONTRIBUTING.md`'s
override table (a dedupe claim that was false, and a `^5.0.8` floor that admitted
the version it existed to exclude) have both been corrected there. **Recommend
closing #444 with this evidence.**

No dependency was added by this task.

### 6.2 Images: the pass that did not run, stated as a gap

`trivy`, `osv-scanner`, `grype` and `syft` are **all absent** from this
environment. No container image scan was performed. **A tool that was not run is a
gap in the evidence, not a passed check**, and this is the single largest gap in
this review.

Also confirmed unchanged from #372:

- All six `FROM` lines in `docker/{admin,api,portal}.Dockerfile` are floating
  tags (`node:24-bookworm-slim`), none digest-pinned.
- `.github/dependabot.yml` covers `github-actions` and `npm` only, with no
  `docker` ecosystem.
- `.github/workflows/` contains an SBOM step and no image vulnerability scanner.
  `osv-scanner` appears nowhere.

`docs/SECURITY_DESIGN.md` §9 asserts four things about images; **"pinned base
digests" is false and "`pnpm audit` + osv-scanner in CI" is half false**
(`pnpm audit` runs in `.github/workflows/audit.yml`; osv-scanner does not exist).
Both sentences are corrected in this change under the staleness rule.

**The pinning work itself is not done here, and the Code Owner ruling that
licenses that deferral says more than this review first quoted.** The full
ruling is:

> Not a 1.0 blocker. `docs/features/040-security-review-hardening.md:18` already
> schedules "image scan (trivy) on the three production images; base digests
> pinned", so **040 is its natural home**, and doing it there means we measure
> before and after.

An earlier draft cited only the first clause. That is a selective quotation of a
Code Owner ruling inside a document going to the Code Owner for sign-off, which
is the worst possible place for one, so the whole ruling is reproduced above and
the position is stated plainly: **the ruling nominates 040 as the home for this
work, and 040 has declined it.**

The reasons, so the Code Owner can overrule knowingly rather than infer:

- **It is not blocked on tooling.** `trivy`, `osv-scanner`, `grype` and `syft`
  are absent from this environment, but all four are single-binary installs. The
  honest statement is "not attempted", not "could not be done", and §9 is
  corrected to match.
- **It is a second change, not a rider.** The same ruling requires digest pinning
  and Dependabot container coverage to land **together**; that touches
  `docker/*.Dockerfile`, `.github/dependabot.yml` and a new CI job, and it wants
  the Compose gate re-run. Attaching it to a review whose subject is verification
  would mix a measurement with a modification of the thing measured.
- **The "measure before and after" value survives the deferral**, because the
  before-state is now recorded precisely (§6.2: six floating `FROM` lines, no
  `docker` ecosystem, no scanner anywhere in `.github/`). A later change can
  measure against that.

**This is a deviation from a written instruction and is recorded as one**, not
presented as compliance. If the Code Owner wants it inside 040, the work is
scoped in #372 and this document should not be signed off until it lands.

### 6.3 Repository posture

Verified against the live GitHub configuration on 2026-08-14, not against the
documentation of it. The `protect-main` ruleset is **active** on the default
branch and carries: `deletion`, `non_fast_forward` (no force-push to `main`),
`required_linear_history`, `pull_request` (no direct pushes), and
`required_status_checks` with four contexts: `verify (node-24)`, `api-e2e`,
`portal-e2e` and `full-stack-e2e`. That matches SEC-11's "branch protection,
required CI, no force-push to main".

Two observations, neither a finding:

- **`portal-e2e` is a stale job name, not a coverage gap.** It runs
  `pnpm exec playwright test` with no project filter, and `playwright.config.ts`
  carries an `admin-chromium` project alongside the portal ones, so the admin
  browser suite is covered by a required check whose name does not say so.
- **npm 2FA and provenance cannot be verified.** No `@qcms/*` package has been
  published and the npm organisation does not exist (#360), so there is no
  account to check 2FA on and no publish to attach provenance to. See §8,
  criterion 4.

The 037 scaffold-output secret scan named in the task deliverables is **not
applicable yet**: 037 has not shipped (PR #451 open), so there is no scaffold
output to scan and no 037 CI to wire it into.

---

## 7. An observation against the §3.2 matrix, not a defect

The "Internal service token alone" column marks every row with a cross **except
`Health/ready`**, which is a tick, and the rows it crosses include "Start
anonymous session". (An earlier draft of this paragraph said "every row", which
is contradicted by the table two lines above it. Corrected here rather than left
standing, since a document about claims outrunning their evidence cannot afford
a miscount of the table it is describing.) In the code, `POST /sessions` carrying only
the SEC-4 channel token succeeds with 201. It has to: that is exactly how the
portal BFF starts a session for an anonymous respondent, and the same row's first
column already marks it reachable by anonymous callers.

The column means "the service token confers no identity, and therefore no
*authorized* action" rather than "any request carrying it alone is refused". The
control on that row is rate limiting (026), not authentication. The matrix suite
asserts the true behaviour and names the reading; the table itself is left alone
because changing a cell would misstate the property it is recording.

---

## 8. Exit criteria: honest state at close of review

| # | Criterion | State |
|---|---|---|
| 1 | Matrix suite green in CI, permanently | **Met.** `apps/api/e2e/security/` is picked up by the existing `qcms-api-e2e` project glob, so it runs in the `verify` job on every push with no CI wiring change - **that membership is the criterion, and it is what does not go stale**. The case count is a measurement, not a promise: 4 files and 201 cases at `3dd475d`, and it moves whenever a case is added. It has already been quoted stale twice in this document, which is why it is now written with the commit it was measured at rather than as a bare figure. |
| 2 | All SEC-1…13 rows check out; deviations documented | **Met, with deviations documented in §4.** SEC-5 is reserved and unbuilt by design; SEC-13 was not re-verified here and relies on 054/062's suites; SEC-11 is the row with the real gap and it is named. |
| 3 | Zero open high-severity findings; review doc committed | **Not met.** Review doc committed. **Two open highs: #470 (fix in flight on PR #480) and #390 (needs a Code Owner ruling).** The third high found by this review (F1, placeholder secrets) is fixed. |
| 4 | `SECURITY.md` published; provenance publish verified | **Half met.** `SECURITY.md` is published and updated by this change: private disclosure via GitHub advisories, a response commitment, a supported-versions policy and a scope statement. **The provenance half is blocked on #360: the npm organisation does not exist and no `@qcms/*` package has been published, so `npm publish --provenance` cannot be configured, exercised or dry-run against a real registry. This is a Code Owner action and a 1.0 blocker in its own right; it is recorded as blocked, not claimed and not omitted.** |
| 5 | 038's pre-flight references this review doc by date | **Met as far as 040 can meet it.** `docs/features/038-launch-gate-validation.md`'s pre-flight list now cites this document by path and date, with the note that a later pass supersedes it. Actually *running* the pre-flight is 038's work and 038 has not run. |

**On #361.** Its criterion is "zero open high-severity findings", which is
criterion 3 above. That criterion is **not met today**, on two named findings with
two named owners: #470 needs PR #480 merged, #390 needs a ruling. Neither is
blocked on anything this task can do. Criterion 4's provenance half does **not**
hold #361 open; it belongs to #360.

---

## 8a. Issues this change closes, named rather than implied

A finding closed silently inside a large task is a finding nobody can audit
later, so each one is named here and in the pull request body.

| Issue | How this change closes it |
|---|---|
| **#471** | `apps/api/src/middleware/security-headers.ts` sets the SEC-9 header set on every API response, asserted on served, refused and 404 responses in `02-transport-and-limits.e2e.ts`. `docs/SECURITY_DESIGN.md` §5's "Delivered: 017" is now true rather than aspirational. |
| **#444** | Recommended for closure rather than closed by a code change: the two advisories no longer resolve in the lockfile and `pnpm audit` reports zero findings (§6.1). Closing it is a judgement for whoever merges. |

**Not closed, and deliberately not touched:** #470 (fix in flight on PR #480),
#478 (claimed on `fix/478-revoke-form-scope`), #390 and #482 (need a ruling),
#372 (needs its own change with an ordering constraint), #432, #401, #402.

---

## 9. What could not be verified, and why

Stated as gaps in this document rather than as passed checks.

1. **Container image vulnerability scanning.** No scanner is installed (§6.2).
2. **npm provenance publishing.** Nothing is published; the npm organisation does
   not exist (#360).
3. **Whether the CSV formula-injection payloads execute** in the Excel and
   LibreOffice versions an operator would plausibly use. No spreadsheet was
   available. The severity rests on the control being absent on
   attacker-controlled data while the same repository applies it to safe data.
4. **The `create-qcms-app` generated tree.** Not merged; not reviewed (§1).
5. **SEC-13 telemetry redaction** was not re-run here; it rests on 054/062's
   suites. The `application.event` fallback's silent-observability failure mode
   was identified but not exercised.
6. **The admin-gate ordering invariant** (`registerAdminAuth` must be first in
   the `admin` bucket) is asserted in seven comments. This review's matrix suite
   composes the **real** `appGroups` and would fail if the gate were absent, which
   is stronger than the per-slice tests, but a deliberate reordering was not
   performed.
7. **Portal and admin header coverage.** The admin proxy has thorough header and
   no-CORS assertions; the portal sets `nosniff`, `Referrer-Policy` and
   `X-Frame-Options` in `apps/portal/proxy.ts` with **no test asserting any of
   the three**, and the portal has no Origin / `Sec-Fetch-Site` check at all
   (the admin does, source-gated per route). Recorded; not closed here, to keep
   this change out of the browser-gated trees.
8. **Real-world load behaviour of the per-process rate limiters** (§3.8).

---

## 10. Recommended follow-ups, and where each one now lives

Every medium and low finding this review recorded is **ticketed**, filed 2026-08-14
from the ordered list below. The judgement not to fix them inside 040 stands (each
is browser-gated, a decision, or an operator-facing document), but a finding that
lives only in a review document is a finding nobody is going to action.

| # | Follow-up | Where it lives now |
|---|---|---|
| 1 | Merge PR #480 (#470). The only open high anyone is already working on, and the one thing standing between this tree and criterion 3 | **#470** / PR #480 |
| 2 | Rule on #390, then add the boot line naming whether the sign-in throttle is active and what trusted-hop count resolved | **#390** (needs a Code Owner ruling) |
| 3 | Give the portal the Origin/Sec-Fetch-Site check the admin has | **#487** |
| 4 | Record that every rate limit is per-process, so replicas multiply them | **#488** |
| 5 | Redact `Error.message` / `Error.stack` on the stdout path, or record the accepted risk | **#489** |
| 6 | Add the two retention-sweep messages to the OTLP allowlist, and consider a test for the silent-blanking failure mode | **#490** |
| 7 | Extend the placeholder-secret boot refusal to the portal and admin config modules | **#491** |
| 8 | Write the SEC-10 app/migration role split the design pointed at 036 for | **#492** |
| 9 | `portal-e2e` under-reports its own scope as a required check | **#493** |
| 10 | A poisoned turbo cache entry survives `--force` and fails `@qcms/db` in every worktree | **#494** |
| 11 | Close #444: it no longer reproduces | **#444** (evidence posted as a comment) |
| 12 | #372 (base digests plus Dependabot container coverage, together) and image scanning in CI. Not a 1.0 blocker per the Code Owner, but it is what turns §6.2 from a gap into evidence | **#372** |

Items 3 through 10 were filed by this task. Items 1, 2, 11 and 12 already had
issues and are referenced rather than duplicated.

---

## 11. Sign-off

**Unsigned.** The 040 security review is a Code Owner gate. This document is the
evidence for that gate and asserts nothing about its outcome.
