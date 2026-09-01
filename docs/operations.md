# QCMS operations guide

Running a QCMS deployment: what the processes expect from their environment, what
their health signals mean, how to upgrade one, and the runbooks for the things that
actually page someone.

This guide is topology-agnostic. The two deployment shapes it applies to are the
single-host Compose stack (`docker-compose.yml`, quickstart in `README.md`) and the
segmented multi-instance shape (`docs/deploy-enterprise.md`). Ingress and TLS are
operator infrastructure and live in `docs/deploy-ingress.md` (ADR-20). Backup policy
and the restore drill live in `docs/backup-restore.md`.

## Process model

| Process       | Image                      | Holds a database credential | Serves                                        |
| ------------- | -------------------------- | --------------------------- | --------------------------------------------- |
| `qcms-api`    | `docker/api.Dockerfile`    | yes, the only one (ADR-35)  | the API route groups its `QCMS_MOUNT` selects |
| `qcms-portal` | `docker/portal.Dockerfile` | no                          | the respondent surface, as a strict BFF       |
| `qcms-admin`  | `docker/admin.Dockerfile`  | no                          | the authoring surface, as a strict BFF        |
| `migrate`     | `docker/api.Dockerfile`    | yes                         | nothing; runs once and exits                  |

Both front ends reach the API over the internal network and hold no database
credential of their own. That is a control, not an accident: after task 056 the API
is the sole domain-data client, so a compromised BFF cannot read the database
directly. The admin's import-surface test refuses a database import outright.

### Outbound network the API needs

Two destinations, both from `qcms-api` only, and both worth knowing before you write
an egress firewall rule:

| Destination                      | When                                                                                            | If it is blocked                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your webhook consumers           | Whenever a submission is delivered (SEC-6, SSRF-guarded)                                        | Deliveries retry and eventually park in the outbox; nothing else is affected.                                                                                                                          |
| `api.pwnedpasswords.com` (HTTPS) | Only while an **admin password is being set**: `qcms:create-admin`, and change-password (SEC-1) | **The password is refused, by design.** A first admin cannot be created at all. Set `QCMS_ADMIN_PASSWORD_BREACH_CHECK=false` for a deployment that is genuinely offline; see the variable's row below. |

Nothing else in the API reaches the internet. The portal and the admin reach only the
API.

**What that second refusal looks like**, so it is not mistaken for a broken sign-in
(issue #436). A blocked corpus lookup answers `503` with the code
`BREACH_CORPUS_UNREACHABLE`, and `qcms:create-admin` prints one line naming the host,
saying in as many words that this is a network failure rather than an authentication
failure, and pointing at `QCMS_ADMIN_PASSWORD_BREACH_CHECK`. A password that really is
in the corpus is a different answer entirely: `400` with `PASSWORD_COMPROMISED`, and a
line that says the password appears in the corpus. Telling the two apart never requires
reading the source.

### Rate limits are per-process, so replicas multiply them

**Every rate limit in QCMS is counted inside one API process. Run N API processes and
the effective allowance is N times the configured one** (SEC-8 in `docs/SECURITY_DESIGN.md`
§8, issue #488). Nothing warns you about this, and no setting changes when you scale, so
it is a thing to decide before you add the second replica rather than after.

It applies to both per-address controls, including the one whose multiplication was not
written down anywhere before:

| Control                                                                     | Where the tally lives                                            | Two replicas mean                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| Respondent limiters (start a session, answer, submit - task 026)            | `InMemoryRateLimitStore` in the API process                      | Twice the configured maximum per client address       |
| Admin sign-in throttle (`/sign-in`, `/change-password`, `/two-factor/*`)    | better-auth's in-memory limiter, one map per process             | Six password attempts per ten seconds, not three      |

Three ways to get the number you actually configured, cheapest first:

1. **Divide the configured maxima by the replica count.** Costs nothing but arithmetic,
   and is exact only while every replica is up.
2. **Enforce the outer limit at the ingress.** It is the one hop that sees all of the
   traffic, and both recipes in `docs/deploy-ingress.md` are the place to put it. This
   is the answer for absorption-scale abuse in any case.
3. **Implement a shared store.** The API's `RateLimitStore` interface (task 017) is the
   documented swap for a Redis-backed one; better-auth's limiter is a separate store
   with its own configuration. QCMS ships neither.

If you run exactly one API process, which the single-host Compose stack does, there is
nothing to do here. `docs/deploy-enterprise.md` §5 carries the same fact for the
segmented topology.

## Health and readiness

The API mounts two unauthenticated ops endpoints in **every** process shape, because
an orchestrator has to reach them before any credential exists:

| Endpoint      | Meaning                                                                                 | Failure mode                                                        |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /health` | Liveness. The process is up and serving. Static, touches nothing.                       | Only fails when the process is gone.                                |
| `GET /ready`  | Readiness. Probes the database with a bounded timeout (`QCMS_READINESS_DB_TIMEOUT_MS`). | Database down or slow: **503 with a clean JSON body**, never a 500. |

The 503 is deliberate. A failing dependency is an expected state, not a crash, so it
reports `{ status: "unavailable", checks: { db: "down" } }` and stays up. Point
load-balancer health checks at `/ready` and restart policies at `/health`: a database
blip should take an instance out of rotation, not into a restart loop.

The container healthchecks already encode this, and they differ per image because the
front ends have no database of their own to probe:

| Image         | Healthcheck target |
| ------------- | ------------------ |
| `qcms-api`    | `/ready`           |
| `qcms-portal` | `/`                |
| `qcms-admin`  | `/healthz`         |

## Logs

Every process writes **JSON lines to stdout**. There is no log file, log-shipping
sidecar or bundled production observability stack: collection and retention remain
the operator's. When the standard OTLP endpoint is configured, the same application
events also produce privacy-reduced OTLP log records alongside traces.

The line shape is `{ level, time, msg, ...fields }`, with `level` as a word
(`debug`/`info`/`warn`/`error`) and `time` as an ISO instant. When the OpenTelemetry
SDK is enabled the shared server logger adds `trace_id` and `span_id` to every line,
so logs correlate to traces with no call-site change (ADR-34). OTel is configured
through the standard `OTEL_*` variables in the reference below; leave them unset and
the SDK stays off.

**Answer values, direct identifiers and secrets are never logged.**
Handlers use route templates and opaque ids, while the stdout redactor masks
sensitive-looking fields before serialization. OTLP applies a stricter independent
allowlist: unknown event names are normalized and unknown attributes are discarded
before batching. Treat `[REDACTED]` as the control working, not as missing data; use
`requestId`, `errorId`, `trace_id` and `span_id` for diagnosis (SEC-13).

**Exception text is the deliberate exception, so treat application logs as
potentially answer-bearing (issue #489).** This paragraph used to say free-text errors
were never logged, and that was not true of stdout: the redactor masks by field name,
and an `Error` is written out as `{ name, message, stack }` before that test, so an
exception's message and stack reach the log line intact. Nothing in QCMS logs an answer
value on purpose - a CI gate refuses a call site that would - but an error raised
further down can carry the offending value inside its own message, and a database
driver or a validator is exactly the kind of thing that does. So give application logs
the retention window, access control and shipping policy you give the database, and do
not paste a raw log into a ticket without reading it first. The exported OTLP records
are not affected: they carry allowlisted scalar attributes only, and no exception text
crosses that boundary at all.

### Checking that sign-in throttling is running

The admin sign-in surface is brute-force throttled by better-auth: three attempts per
ten seconds per client address on `/sign-in`, `/change-password` and `/two-factor/*`
(SEC-1). It is **on by default in every environment**, and the only thing that turns it
off is `QCMS_ADMIN_SIGNIN_THROTTLE` set to a false value. A deployment that configures
nothing is throttled.

**The three attempts are per process, not per deployment** (issue #488). better-auth's
limiter keeps its counts in memory and QCMS gives it no shared store, so a second API
process that mounts the admin surface brings a second empty tally with it. See "Rate
limits are per-process" above before you scale the admin surface out.

`NODE_ENV` does not decide this, and that is worth knowing if you have read
better-auth's own documentation: the library defaults its limiter to on only under
`NODE_ENV=production`, reading the value once at startup, and QCMS deliberately does not
inherit that (issue #390). A general-purpose variable that gets set, and left unset, for
a dozen unrelated reasons is the wrong switch for a security control, and a process
started outside the shipped images used to run unthrottled because of it.

An API process that mounts the admin surface says which it is, once, at boot:

```json
{
  "level": "info",
  "time": "2026-08-15T08:32:40.128Z",
  "service": "qcms-api",
  "enabled": true,
  "addressHeaders": "x-qcms-client-address",
  "msg": "sign-in throttling active"
}
```

or, when it is not running,

```json
{
  "level": "warn",
  "time": "2026-08-15T08:32:40.128Z",
  "service": "qcms-api",
  "enabled": false,
  "addressHeaders": "x-qcms-client-address",
  "msg": "sign-in throttling is NOT running in this process: ..."
}
```

Both examples are real emitted lines and parse as JSON, so you can pipe them straight
into `jq` while building a filter. Two things to expect from the shape: `msg` comes
**last**, after the fields, because the logger appends it there, so match on the fields
rather than on position. And the second example abbreviates the `msg` value, which in a
real line continues past the colon with what is switched off and what decides it; the
ellipsis is inside the string, so the line still parses.

Grep the first boot lines for `sign-in throttling`. The state is read back from the
limiter's own resolved configuration rather than from what this deployment asked for,
so the line reports what is true even when the two differ. `addressHeaders` names the
header the limiter keys buckets on, never an address (SEC-8, SEC-13); make sure your
ingress feeds it, per `docs/deploy-ingress.md`, or every caller shares one bucket.

The warn line is what an image carrying a development value looks like from outside, and
it is the reason the switch is a QCMS-owned variable rather than an inference: the only
way to reach that line is for something to have set `QCMS_ADMIN_SIGNIN_THROTTLE` false,
and the line names it. If you see it in a deployment, unset the variable and restart. The
repository's own `pnpm dev:portal` and `pnpm dev:admin` set it false, so this warn line
is expected there and nowhere else.

## Environment reference

Generated from the code that reads each variable, and asserted against it by
`scripts/env-reference.test.ts`: a variable added to a composition root fails that
test until it is documented here, and a deleted one fails until its row goes. Do not
hand-edit the block below. Change the table in `scripts/env-reference.mjs` and run:

```bash
node scripts/env-reference.mjs --write
```

Sample values for the Compose topology are in `.env.compose.example`. Secret values
are never echoed by any process, and no value appears in this document.

<!-- BEGIN GENERATED: env-reference (node scripts/env-reference.mjs --write) -->

#### API (`qcms-api`)

Validated at boot by `apps/api/src/config.ts`, which collects every problem and fails fast naming the variables, never the values (SEC-8).

| Variable                            | Required     | Default                                          | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (secret)             | **required** | -                                                | Postgres connection string. The API is the only process in either topology that holds one (ADR-35). Compose builds it from the `QCMS_DB_*` values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `QCMS_MOUNT`                        | **required** | -                                                | Which route groups this process serves: a comma-separated list of `public`, `internal`, `admin`, or the shortcut `all`. Unmounted routes do not exist (404, not 403 - ADR-09). The outbox deliverer and retention sweep run in the process that mounts `internal`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `QCMS_LINK_KEYS` (secret)           | **required** | -                                                | Secure-link signing keys, at least 32 characters each. Comma-separated: the first signs, all verify. Rotation runbook: `docs/secure-links.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `QCMS_SESSION_KEYS` (secret)        | **required** | -                                                | Respondent session-token signing keys, at least 32 characters each. Same first-signs-all-verify rotation model as `QCMS_LINK_KEYS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `QCMS_INTERNAL_TOKEN` (secret)      | **required** | -                                                | Service tokens the BFFs present on every internal call (SEC-4), at least 32 characters each. Any listed token is accepted, which is what makes rotation a two-deploy operation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QCMS_APP_KEY` (secret)             | **required** | -                                                | AES-256-GCM key (at least 32 characters) encrypting secrets at rest (SEC-6). It covers exactly one column, the per-webhook HMAC signing secret; stored two-factor material belongs to `QCMS_ADMIN_AUTH_SECRET`, not to this key (issue #319). **Set it once**: there is no in-place rotation, so changing it makes every stored webhook secret undecryptable at once and those deliveries dead-letter. That is recoverable without the old key by re-issuing each webhook's secret from the admin, which costs re-coordination with every consumer rather than data. See the app-encryption-key runbook below (issue #323).                                                                                                                                                                                                                                                                                                                                                                                |
| `QCMS_PORTAL_BASE_URL`              | **required** | -                                                | Public origin of the respondent portal, used to build the secure-link URLs authors copy. Absolute http(s); a trailing slash is stripped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `QCMS_ADMIN_AUTH_SECRET` (secret)   | conditional  | -                                                | better-auth signing secret, at least 32 characters. Required when `QCMS_MOUNT` includes `admin`. It also protects stored two-factor material (TOTP secrets and recovery codes are encrypted under it), so back it up with the database. Rotate it through `QCMS_ADMIN_AUTH_SECRETS` rather than by editing this value, which would leave every enrolled authenticator unreadable (SEC-7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `QCMS_ADMIN_AUTH_SECRETS` (secret)  | optional     | `unset - version 1 holds QCMS_ADMIN_AUTH_SECRET` | Versioned admin auth keys for non-destructive rotation, as comma-separated `<version>:<secret>` entries, newest first (for example `2:<new>,1:<old>`). The first entry encrypts new material; the rest stay readable. Each value has the same 32-character floor, and the API refuses to start on a list that is not in descending version order, since a list written the other way round would keep encrypting under the old key. Leave it unset unless you are rotating; the rotation runbook is in the key-rotation section below (SEC-7, issue #319).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `QCMS_ADMIN_BASE_URL`               | conditional  | -                                                | Public origin of the **admin app**, not of this API. Required when `QCMS_MOUNT` includes `admin`: it is the origin better-auth scopes cookies to and the only origin it trusts, so it must match what the browser sees exactly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QCMS_TURNSTILE_SITE_KEY`           | conditional  | -                                                | Turnstile site key. Required when `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`, ignored otherwise. The **same variable the portal reads**, spelled identically (issue #331): it is one public key, so one name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `TURNSTILE_SITE_KEY`                | optional     | (none)                                           | **Deprecated** (issue #331). The pre-consolidation spelling of `QCMS_TURNSTILE_SITE_KEY`, still read as a fallback so an existing deployment keeps working; the API logs a one-line warning at boot when it is set. `QCMS_TURNSTILE_SITE_KEY` wins if both are set. Set the prefixed name and delete this one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `TURNSTILE_SECRET_KEY` (secret)     | conditional  | -                                                | Turnstile verification secret. Required when `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`, ignored otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PORT`                              | optional     | `3000`                                           | TCP port the API listens on inside its container. `QCMS_PORT` is accepted as a fallback spelling. The images expose 3000 and Compose never republishes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `QCMS_PORT`                         | optional     | `3000`                                           | Prefixed alias for `PORT`, read only when `PORT` is unset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `NODE_ENV`                          | optional     | `production (set by the image)`                  | Decides the default for `QCMS_ADMIN_SECURE_COOKIES` when that is unset. The production Dockerfiles set it; do not unset it in a deployment. It does **not** decide whether admin sign-in is throttled, whatever better-auth's own documentation says about its limiter defaulting to production-only: `QCMS_ADMIN_SIGNIN_THROTTLE` decides that here, in every environment (SEC-1, issue #390).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QCMS_FLAG_CHALLENGE_PROVIDER`      | optional     | `none`                                           | Abuse-control challenge provider (ADR-24 registry): `none` or `turnstile`. An unknown `QCMS_FLAG_*` variable fails boot rather than being ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `QCMS_ADMIN_2FA`                    | optional     | `required`                                       | Administrator TOTP policy (SEC-1): `required` or `optional`. `optional` is a development escape hatch, never a production setting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `QCMS_ADMIN_SECURE_COOKIES`         | optional     | `true when NODE_ENV=production`                  | Whether cookies set on the admin origin carry `Secure`. It describes the **browser-facing** scheme, which this process cannot observe, so it is a knob rather than only an inference. Must hold the same value in the `api` and `admin` services or the browser keeps one cookie family and drops the other. The `admin` service refuses to start when it is false at a non-loopback `QCMS_ADMIN_BASE_URL` (issue #292), so a downgrade here is refused by the process the browser actually reaches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `QCMS_ADMIN_PASSWORD_BREACH_CHECK`  | optional     | `true`                                           | Whether an admin password is checked against the public breach corpus before it is accepted (SEC-1; NIST SP 800-63B Rev 4 3.1.1.2, OWASP ASVS 5.0 6.2.12). When on, setting a password makes one HTTPS request to `api.pwnedpasswords.com/range/{prefix}` carrying the first five hex characters of the password's SHA-1 and nothing else; the password never leaves the process. **The check fails closed**: if that host is unreachable the password is refused, so on an air-gapped deployment `qcms:create-admin` cannot create the first admin at all until you set this to `false`. Doing so is a documented downgrade against both standards, supported for a structurally offline deployment and as the break-glass for rotating a leaked password while the corpus is unreachable; the API and the CLI each log a loud warning at startup for as long as it is off.                                                                                                                               |
| `QCMS_ADMIN_SIGNIN_THROTTLE`        | optional     | `true`                                           | Whether the admin sign-in surface is brute-force throttled (SEC-1). On, three attempts per ten seconds per client address are allowed on `/sign-in`, `/sign-up`, `/change-password`, `/change-email` and `/two-factor/*`, and a fourth is refused with a `429`. **Defaults to on in every environment**, so a deployment that configures nothing is throttled; `NODE_ENV` has no say in it either way, which is deliberate (issue #390) and is the one place QCMS departs from better-auth's documented default. Setting it false is a development escape hatch for a local loop that signs in repeatedly, and it is the only way to turn the control off: a deployment that sets it serves an unlimited admin sign-in surface. The API logs a loud warn line naming this variable at every boot for as long as it is off, so an image that carries the development value is visible from the first line of its log rather than from an incident. See "Checking that sign-in throttling is running" above. |
| `QCMS_ADMIN_SESSION_IDLE_MS`        | optional     | `3600000 (1h)`                                   | Idle window before an administrator session expires (SEC-1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `QCMS_ADMIN_SESSION_MAX_AGE_MS`     | optional     | `43200000 (12h)`                                 | Absolute administrator session lifetime measured from issue (SEC-1). Past it every admin call is a 401 regardless of activity, which is the cap an idle window alone cannot provide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `QCMS_SESSION_TTL_MS`               | optional     | `86400000 (24h)`                                 | Lifetime of an anonymous respondent session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `QCMS_WEBHOOK_ALLOW_PRIVATE`        | optional     | `false`                                          | SSRF override (SEC-6). While false, webhook targets must be HTTPS and must not resolve to private, reserved, loopback or link-local hosts. Set true only for an on-prem topology that legitimately posts to an internal system.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QCMS_WEBHOOK_TIMEOUT_MS`           | optional     | `10000`                                          | Per-attempt webhook delivery timeout. A slower response is a failed attempt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `QCMS_WEBHOOK_BATCH_SIZE`           | optional     | `20`                                             | Deliveries one outbox pass processes. Bounds the row locks held per tick; the interval drains the rest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `QCMS_OUTBOX_INTERVAL_MS`           | optional     | `5000`                                           | How often the outbox deliverer runs, in the process that mounts `internal`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `QCMS_OUTBOX_JITTER_MS`             | optional     | `1000`                                           | Random jitter added to the outbox interval, so several API instances do not tick in lockstep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `QCMS_RETENTION_SWEEP_INTERVAL_MS`  | optional     | `3600000 (1h)`                                   | How often the retention sweep runs: expired anonymous sessions, aged webhook response snippets, and aged outbox payloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `QCMS_DELIVERY_SNIPPET_TTL_MS`      | optional     | `604800000 (7d)`                                 | How long a webhook delivery keeps the stored prefix of the consumer's response body, measured from the attempt. That body can echo a respondent's answers back, so it ages out; the rest of the attempt record is value-free and is kept. `0` removes it at the next sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `QCMS_OUTBOX_PAYLOAD_TTL_MS`        | optional     | `2592000000 (30d)`                               | How long a settled outbox event keeps the answers its payload carries, measured from the moment the event and its whole fan-out stopped moving. The payload is a second copy of the respondent's answers kept only so a delivery can be re-sent, so it ages out with that capability; the envelope and the delivery record are kept. `0` drops them as soon as the fan-out settles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `QCMS_READY_DB_TIMEOUT_MS`          | optional     | `2000`                                           | Timeout for the `/ready` database probe. Exceeding it makes `/ready` answer 503, never 500.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `QCMS_BODY_LIMIT_BYTES`             | optional     | `1000000 (1MB)`                                  | Maximum request body the API accepts (SEC-9). Keep the ingress ceiling in step with it: both recipes set one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `QCMS_ANTIABUSE_MIN_SUBMIT_MS`      | optional     | `0 (off)`                                        | Global floor on the gap between session start and submit. A faster submit is silently flagged; a form may set its own floor that overrides this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `QCMS_ANTIABUSE_HONEYPOT_FIELD`     | optional     | `the compiler's HONEYPOT_FIELD_NAME`             | Name of the decoy submit field. It is a contract between the compiler and the API, so override it only if you also change the compiler constant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `QCMS_RL_SESSION_CREATE_WINDOW_MS`  | optional     | `3600000 (1h)`                                   | Rate-limit window for `POST /sessions`. Keyed by the client address the portal BFF vouched for: see `QCMS_RL_SESSION_CREATE_MAX`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `QCMS_RL_SESSION_CREATE_MAX`        | optional     | `20`                                             | Sessions one client address may start per window. The limiter keys on the address the portal BFF vouched for, which it resolves from the ingress's `X-Forwarded-For` by counting `QCMS_PORTAL_TRUSTED_PROXY_HOPS` entries from the right - a client-supplied value cannot move the bucket. **Behind no ingress at all** (the local Compose quickstart, or a deployment where the ingress writes no forwarded header) there is no address to vouch for and every respondent shares one `unknown-ip` bucket, making this a whole-deployment ceiling of 20 session starts per hour: set the ingress up per `docs/deploy-ingress.md`, or raise this to your expected peak.                                                                                                                                                                                                                                                                                                                                     |
| `QCMS_RL_ANSWERS_SESSION_WINDOW_MS` | optional     | `5000`                                           | Rate-limit window for answer submission, keyed by session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `QCMS_RL_ANSWERS_SESSION_MAX`       | optional     | `10`                                             | Answers one session may submit per window (a burst ceiling, about 2/s sustained).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `QCMS_RL_ANSWERS_IP_WINDOW_MS`      | optional     | `60000`                                          | Rate-limit window for answer submission, keyed the same way as `QCMS_RL_SESSION_CREATE_MAX` and subject to the same no-ingress caveat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `QCMS_RL_ANSWERS_IP_MAX`            | optional     | `300`                                            | Answers that may be submitted per window across every session sharing one client address: the wide backstop against many-session floods from one source. Keyed and caveated exactly as `QCMS_RL_SESSION_CREATE_MAX`; the per-session limits above are unaffected either way, because a session id is always visible.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `QCMS_RL_SUBMIT_SESSION_WINDOW_MS`  | optional     | `60000`                                          | Rate-limit window for `POST /sessions/{id}/submit`, keyed by session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `QCMS_RL_SUBMIT_SESSION_MAX`        | optional     | `5`                                              | Submit attempts one session may make per window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `OTEL_EXPORTER_OTLP_ENDPOINT`       | optional     | (none)                                           | OTLP collector endpoint (ADR-34). Unset is a hard no-op. Setting it exports traces plus SEC-13-allowlisted logs and adds `trace_id`/`span_id` to stdout records.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `OTEL_SERVICE_NAME`                 | optional     | `qcms-api`                                       | Service name reported on exported traces and logs. Read only when telemetry is on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `QCMS_ADMIN_EMAIL`                  | conditional  | -                                                | First-run bootstrap only. Read by `node dist/create-admin.js` to create the first administrator; never read by the serving process.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `QCMS_ADMIN_PASSWORD` (secret)      | conditional  | -                                                | First-run bootstrap only, alongside `QCMS_ADMIN_EMAIL`. Pass it per-command, never in the `.env` file. Put the value in the environment of the command you run and name the variable with no value attached (`docker compose exec --env QCMS_ADMIN_PASSWORD ...`): `--env QCMS_ADMIN_PASSWORD=<value>` would place the password in the docker CLI's own argv, which is world-readable in a `ps` listing (issue #440).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `QCMS_ADMIN_NAME`                   | optional     | `the email local part`                           | Display name for the bootstrapped administrator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

#### Portal BFF (`qcms-portal`)

Read on the server only. The portal holds no database credential and reaches the API over the internal network.

| Variable                         | Required     | Default                         | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QCMS_API_BASE_URL`              | **required** | -                               | Internal origin of the API. On the Compose network this is `http://api:3000`; it is never a public URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `QCMS_INTERNAL_TOKEN` (secret)   | **required** | -                               | The service token this BFF presents to the API (SEC-4). Must be one of the tokens the API accepts. Like the API, this app **refuses to boot** when the value is still an example-file placeholder rather than generated material (issue #491); the refusal names the variable and never prints the value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `QCMS_PORTAL_BASE_URL`           | **required** | -                               | This app's own public origin, used to build the redirects a browser follows. Getting it wrong emits a container-internal address a browser cannot reach.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `QCMS_PORTAL_TRUSTED_PROXY_HOPS` | optional     | `1`                             | How many proxies you run between the internet and this app. The client address the API's rate limiters key on is the entry that many places from the **right** of the inbound `X-Forwarded-For`, so entries a client wrote itself are never reached. `1` is correct for both recipes in `docs/deploy-ingress.md`. **Setting it higher than the number of proxies that actually exist makes per-address rate limiting bypassable** (the resolver reads into client-supplied text); setting it lower is safe but coarse (respondents get bucketed by a proxy's egress address); `0` trusts no forwarded header and puts every respondent in one bucket. A non-numeric or out-of-range value is refused rather than defaulted. |
| `QCMS_SECURE_COOKIES`            | optional     | `true when NODE_ENV=production` | Whether respondent session cookies carry `Secure`. Setting it false is a downgrade, supported only when `QCMS_PORTAL_BASE_URL` is a loopback origin such as `http://localhost:7000`: at any other origin the portal **refuses to start**, naming this variable (issue #292). Leave it unset behind TLS.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `NODE_ENV`                       | optional     | `production (set by the image)` | Decides the default for `QCMS_SECURE_COOKIES` when that is unset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `QCMS_FLAG_CHALLENGE_PROVIDER`   | optional     | `none`                          | Must match the API's value. `turnstile` makes the portal render the widget; anything else renders none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `QCMS_TURNSTILE_SITE_KEY`        | conditional  | -                               | Turnstile site key for the rendered widget. Required when the portal's challenge provider is `turnstile`. The **same variable the API reads** since issue #331 consolidated the two spellings onto this one, so set it once for both processes; the API still accepts the deprecated bare `TURNSTILE_SITE_KEY` and warns at boot.                                                                                                                                                                                                                                                                                                                                                                                           |
| `QCMS_PORTAL_THEME`              | optional     | `slate`                         | Managed portal theme (ADR-30). An unrecognised value falls back silently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `QCMS_PORTAL_MODE`               | optional     | `auto`                          | Default light/dark mode: `light`, `dark` or `auto`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `QCMS_PORTAL_CORNERS`            | optional     | `subtle`                        | Corner-radius token group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `QCMS_PORTAL_DENSITY`            | optional     | `the @qcms/ui default density`  | Spacing token group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `QCMS_PORTAL_FONTS`              | optional     | (none)                          | Font stack selection from the allowlist in `apps/portal/lib/server/theme.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `QCMS_PORTAL_FONT`               | optional     | `the system font stack`         | Single font family override.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `QCMS_PORTAL_BRAND_NAME`         | optional     | (none)                          | Brand name shown in the portal header. Empty renders no brand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `QCMS_PORTAL_BRAND_LOGO`         | optional     | (none)                          | URL of the brand logo shown in the portal header.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `OTEL_EXPORTER_OTLP_ENDPOINT`    | optional     | (none)                          | OTLP collector endpoint (ADR-34). Unset means no SDK; set exports traces and SEC-13-allowlisted logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `OTEL_SERVICE_NAME`              | optional     | `qcms-portal`                   | Service name reported on exported traces and logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

#### Admin BFF (`qcms-admin`)

Read on the server only. Since task 056 the admin holds no database credential either (ADR-35).

| Variable                        | Required     | Default                         | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `QCMS_API_BASE_URL`             | **required** | -                               | Internal origin of the API. Since task 056 this is the admin's only route to data of any kind: it holds no database credential (ADR-35).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `QCMS_INTERNAL_TOKEN` (secret)  | **required** | -                               | The service token this BFF presents to the API (SEC-4). Like the API, this app **refuses to boot** when the value is still an example-file placeholder rather than generated material (issue #491); the refusal names the variable and never prints the value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QCMS_ADMIN_BASE_URL`           | **required** | -                               | This app's own public origin. Used for the SEC-9 origin check on state-changing routes, and it must equal the value the API is given.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `QCMS_ADMIN_SECURE_COOKIES`     | optional     | `true when NODE_ENV=production` | Whether the cookies this app sets carry `Secure`. Must equal the API's value: the two set different cookies on one origin, and a disagreement makes sign-in loop. Setting it false is a downgrade, supported only when `QCMS_ADMIN_BASE_URL` is a loopback origin such as `http://localhost:7040`: at any other origin this app **refuses to start**, naming this variable (issue #292).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `QCMS_ADMIN_2FA`                | optional     | `required`                      | Must match the API's value; it decides whether enrollment can be skipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `QCMS_ADMIN_TRUSTED_PROXY_HOPS` | optional     | `1`                             | How many proxies you run between the internet and this app. The address better-auth's per-IP sign-in throttle (SEC-1) keys on is the entry that many places from the **right** of the inbound `X-Forwarded-For`, so entries a client wrote itself are never reached. `1` is correct for both recipes in `docs/deploy-ingress.md`, which front this app exactly as they front the portal. **Setting it higher than the number of proxies that actually exist makes sign-in throttling bypassable** (the resolver reads into client-supplied text, and an attacker rotating the header gets a fresh backoff allowance every attempt); setting it lower is safe but coarse (admins get bucketed by a proxy's egress address); `0` trusts no forwarded header and puts every sign-in attempt in one shared bucket. Separate from `QCMS_PORTAL_TRUSTED_PROXY_HOPS` because the two apps are two hostnames and may sit behind different ingresses - set both, and set them to the same value unless one of them has an extra proxy in front of it. A non-numeric or out-of-range value is refused rather than defaulted. |
| `QCMS_ADMIN_SESSION_MAX_AGE_MS` | optional     | `43200000 (12h)`                | Must match the API's value; used for the app's own session bookkeeping.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QCMS_PORTAL_BASE_URL`          | optional     | (none)                          | The **portal's** variable, read here too: it is the origin a published form's public link is built against, so the builder can show the address respondents use (`${QCMS_PORTAL_BASE_URL}/f/<slug>`). Set the same value the API and the portal get. Unset, the builder shows no link rather than a broken one, which is why it is optional here and required of those two. This app never makes a request to the portal; it writes the address down for an operator to hand out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `QCMS_PORTAL_THEME`             | optional     | `slate`                         | The **portal's** variable, read here too (task 058): it is the theme the preview island opens in, so an author sees a question in the appearance this deployment serves respondents rather than in this app's own Cobalt. Set the same value in both services. It changes nothing about this app's own chrome, which is never adopter-themeable (ADR-26), and an unrecognised value falls back silently exactly as it does on the portal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `NODE_ENV`                      | optional     | `production (set by the image)` | Decides the default for `QCMS_ADMIN_SECURE_COOKIES` when that is unset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | optional     | (none)                          | OTLP collector endpoint (ADR-34). Unset means no SDK; set exports traces and SEC-13-allowlisted logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `OTEL_SERVICE_NAME`             | optional     | `qcms-admin`                    | Service name reported on exported traces and logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

#### Compose-level (`docker-compose.yml`, `docker-compose.proxy.yml`)

Consumed by the Compose files themselves to build the topology; the containers never see them under these names.

| Variable                    | Required     | Default              | Meaning                                                                                                                                                                                                                          |
| --------------------------- | ------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QCMS_DB_PASSWORD` (secret) | **required** | -                    | Postgres superuser password. Compose refuses to start without it.                                                                                                                                                                |
| `QCMS_DB_NAME`              | optional     | `qcms`               | Database name created on first boot of the Postgres volume.                                                                                                                                                                      |
| `QCMS_DB_USER`              | optional     | `qcms`               | Database role created on first boot of the Postgres volume.                                                                                                                                                                      |
| `QCMS_POSTGRES_IMAGE`       | optional     | `postgres:16-alpine` | Postgres image. Override it to pull from a mirror rather than Docker Hub; CI does exactly this.                                                                                                                                  |
| `QCMS_PORTAL_PORT`          | optional     | `7000`               | Host port the portal is published on. Comes from the stable block in `docs/PORTS.md` (R8); move it to run beside a dev server on the same seat.                                                                                  |
| `QCMS_ADMIN_PORT`           | optional     | `7040`               | Host port the admin app is published on. Same allocation rules as the portal.                                                                                                                                                    |
| `QCMS_BIND_ADDRESS`         | optional     | `127.0.0.1`          | Interface the two published apps bind to. The loopback default is a control: a bare publish would listen on every interface, ahead of the host firewall. Widen it only when a separate ingress host must reach these containers. |
| `QCMS_IMAGE_VERSION`        | optional     | `dev`                | Version stamped into the images at build time (`org.opencontainers.image.version`). `pnpm qcms:build-images` derives a real one; a bare `docker compose build` leaves it `dev`.                                                  |
| `QCMS_CADDY_IMAGE`          | optional     | `caddy:2-alpine`     | Ingress image, used only by the `docker-compose.proxy.yml` overlay.                                                                                                                                                              |
| `QCMS_PORTAL_DOMAIN`        | conditional  | -                    | Public hostname Caddy serves the portal on. Required by the proxy overlay; unused without it.                                                                                                                                    |
| `QCMS_ADMIN_DOMAIN`         | conditional  | -                    | Public hostname Caddy serves the admin app on. Required by the proxy overlay; unused without it.                                                                                                                                 |
| `QCMS_ACME_EMAIL`           | conditional  | -                    | Contact address for the Let's Encrypt account. Required by the proxy overlay; unused without it.                                                                                                                                 |

<!-- END GENERATED: env-reference -->

## Upgrading

### Why migration is a separate step

The images do **not** migrate on boot, and the Compose file runs migration as a
one-shot `migrate` service with `restart: "no"`. Two reasons, both operational:

1. **Multi-instance safety.** Migrate-on-boot means every instance races to migrate
   during a rolling deploy. The winner is arbitrary, the losers either block on a
   lock or fail their own boot, and a long migration turns a rolling restart into an
   outage. One explicit step has one runner by construction.
2. **Adopter control.** A schema change is the part of an upgrade an operator wants
   to schedule, rehearse against a restored backup, and be able to stop before it
   starts. Coupling it to process start takes that decision away and hides it inside
   a container's first second.

The cost is one more command in the upgrade, which is the right trade.

### Procedure

```bash
# 1. Read the release notes for migration warnings before anything is stopped.
# 2. Take a backup and confirm it restores (docs/backup-restore.md).
pnpm qcms:drill-restore   # or your own verified restore path

# 3. Pull the new images.
docker compose pull

# 4. Migrate. Nothing else is running the new code yet.
docker compose run --rm migrate

# 5. Restart the services, API first so the BFFs never call an older API.
docker compose up --detach --wait
```

Order matters at step 5: the portal and admin call the API, so the API must be
serving the new contract before they do. `--wait` holds until the healthchecks pass,
so a failure surfaces there rather than as a user-visible error a minute later.

**Rolling back** is a redeploy of the previous image tag, plus a database restore if
the migration was not backward compatible. Migrations are not reversed automatically,
which is the other reason step 2 is not optional. Check the release notes: a
backward-compatible migration lets you roll back images alone.

## Runbooks

### A respondent reports that the form will not submit

**Symptom.** One of two reports, depending on how the respondent was invited:

- They **cannot get past the entry page**: pressing Begin returns them to it under the
  heading "This form is not available". This is the anonymous `/f/{formSlug}` entry path.
- They **already have a session** (which means they arrived by secure link, the only entry
  path that still works for them) and **have JavaScript unavailable or disabled**, and
  pressing Continue on a step lands them back on the same step with no message and their
  typed answers gone.

In both cases the form is published and other respondents are completing it normally, and
**nothing in the portal's logs looks like an error**: the request was refused before it
reached the API, so there is no failed `api.call` and no exception anywhere. There is a
line for it, though, and it is the first thing to look for:

```
grep 'origin.belt.refused' <portal stdout>
```

The respondent is on an old browser in both cases.

**Cause.** The portal's four state-changing BFF routes carry a CSRF belt (SEC-9,
`isSameOriginPost` in `apps/portal/lib/server/route-helpers.ts`). It admits a request that
either declares `Sec-Fetch-Site: same-origin` or `none`, or carries an `Origin` header
matching the portal's own base URL. A browser that sends no Fetch Metadata request headers
can do neither on an ordinary HTML form POST: the portal sends `Referrer-Policy:
no-referrer`, and under that policy a form navigation serializes its `Origin` as the
literal string `null`. Such a request cannot prove it is same-site, so it is refused.

**Which requests this actually affects.** Only the two endpoints a browser reaches by
submitting an HTML form:

| Endpoint                   | Reached by                                                         | The refusal looks like                                                              |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `POST /f/{formSlug}/start` | the Begin button on the entry page, **with or without JavaScript** | 303 back to `/f/{formSlug}?state=error`, which renders "This form is not available" |
| `POST /s/{sessionId}/step` | the no-JS whole-step form (Continue / Back / Submit)               | 303 back to the same step, no message, answers not re-populated                     |

The other two state-changing routes, `POST /s/{sessionId}/answers` and
`POST /s/{sessionId}/submit`, are called only by the hydrated page through `fetch()`. That
is a CORS-mode request, which carries a real `Origin` whatever the referrer policy says,
so those two are unaffected.

**How badly a respondent is stuck depends on which entry path they arrived by**, and the
difference is large enough to establish first:

- **Anonymous entry (`/f/{formSlug}`) is a hard block.** The Begin button is a real form
  POST on **every** path, hydrated or not, so an affected browser cannot start at all. JavaScript
  makes no difference here.
- **Secure-link entry (`/l/{token}`) starts fine.** That route is a **GET** (a silent
  verify-and-redirect that exchanges the token for a session), and the belt covers
  state-changing POSTs only, so it never applies. An affected browser arriving by secure
  link gets a session and, **with JavaScript, completes the whole questionnaire normally**:
  the rest of the hydrated flow is `fetch()`, which is unaffected.

So the only respondent who reaches a step and then cannot get past it is one who arrived by
**secure link with JavaScript unavailable**. That is the second symptom at the top of this
runbook, and it is the only way an affected browser ever reaches a step at all. Since
secure links are the primary distribution path for most deployments, the population fully
locked out is smaller than the raw browser share below suggests: anonymous-entry
respondents are blocked outright, secure-link respondents only if they also have no
JavaScript.

**Which browsers.** `Sec-Fetch-Site` shipped in Chrome 76 (July 2019), Edge 79, Opera 63,
Samsung Internet 12.0, Firefox 90 (13 July 2021) and Safari 16.4 (27 March 2023). The
version numbers are MDN's browser-compat data (only Chrome, Firefox and Safari are stated
there; Edge, Opera, Samsung and the Android engines are mirrored from Chrome). The release
dates are caniuse-db's `version_list`. Anything older sends nothing. Two consequences worth
having in front of you when you take the call:

- **On iOS the browser is irrelevant, the iOS version decides.** Every browser on iOS and
  iPadOS uses the system WebKit, so Chrome, Edge, Firefox and any in-app browser on
  iOS 16.3 all send nothing. The fix there is an iOS update, not a different browser app.
- **Internet Explorer 11 never sends it** and never will.

**The measured share.** About **1.6% of global web traffic** comes from browser versions
that send no Fetch Metadata. That is computed from caniuse's per-version usage data
(caniuse-db snapshot dated 2026-08-07, measuring **July 2026**) by summing the usage of
every tracked version below the thresholds above. Treat it as a **floor, not a point
estimate**, for three reasons:

- Do not quote the 4.94% that caniuse's own method yields for this feature. That figure is
  `100 - supported`, and it folds in the 3.31 percentage points of traffic caniuse
  attributes to no tracked browser at all (unknown user agents, bots): its version tables
  account for only 96.69% of traffic in the first place. Of the 4.94, only 1.63 points are
  identifiably old browsers.
- caniuse collapses every Android-side browser to a single current version. Chrome for
  Android is 46% of global usage and is assumed entirely up to date, so any real tail of
  old Android WebViews is invisible in the number rather than absent from the world.
- Both caniuse and StatCounter beneath it are pageview-weighted rather than user-weighted,
  and neither is a sample of **your** respondents. A questionnaire's population is set by
  who was invited. Global share is a starting point, not a measurement of your deployment.

A realistic band is 1.6% to 5%. The identified 1.63 points split about **40/60 between
mobile and desktop**, which matters because the two age out at different speeds: 0.61
points are iOS below 16.4 (38%), which Apple's own upgrade curve retires steadily, against
0.98 points of old desktop (60%: Chrome below 76 at 0.60, IE 11 at 0.27, macOS Safari below
16.4 at 0.12), which does not retire on anyone's curve. The remaining 0.04 points are old
Firefox and assorted mobile.

**It is concentrated, and not where you might guess.** Per region, from the same source's
`region-usage-json` tables (month 2026-07, accessed 2026-08-07): China 7.07% (5.40 of it IE
11 alone, an enterprise-desktop effect), Japan 5.28% and Germany 4.35% (old desktop Chrome
in both), Oceania 4.11%, Europe 2.33%, against 2.05% for the United States and 1.87% for
the United Kingdom. The low figures the source reports for India (0.17%) and Africa (0.61%)
should **not** be read as measurements: those regions are overwhelmingly Chrome for
Android, which is exactly the population the source cannot version-split. Russia and Korea
carry an unusually large unattributed share (33% and 15% of their traffic respectively,
against 3.6% worldwide), mostly Yandex and Whale, so their apparent 1.78% and 0.89% rest on
a much smaller measured base than the other rows.

**This is deliberate.** The only signal such a request carries is `Origin: null`, and any
attacker's page can produce that too by declaring `Referrer-Policy: no-referrer` on itself.
Admitting `null` would therefore admit the forged request alongside the honest one, so the
belt would stop protecting exactly the clients that cannot prove themselves. Refusing is
the safe direction: a respondent who cannot submit can be helped, while a submission forged
under a respondent's session cannot be unmade.

**What you can do about it.**

1. **Confirm it is this before anything else.** Ask the respondent for their browser and
   version, and on an iPhone or iPad for their iOS version, then compare against the list
   above. A modern browser hitting the same symptom is a different fault.
2. **Tell the two entry-page failures apart in your logs.** `/f/{slug}?state=error` is also
   where a genuine API failure lands, and the two are distinguishable by which line the
   portal wrote: an API failure writes an `api.call` line carrying a non-2xx `status`, a
   belt refusal writes an `origin.belt.refused` line and never calls the API at all. Read
   the refusal line's fields (below) to tell the old browser from the forged request.
3. **Send them a secure link.** This is the one workaround that needs nothing from the
   respondent, and it works because `/l/{token}` is a GET the belt does not cover. A
   respondent blocked at anonymous entry will start fine from a secure link, and unless
   they also have JavaScript unavailable they will complete the questionnaire normally.
   Issue the link from the admin as you would for any invited respondent
   (`docs/secure-links.md`). It does **not** help a respondent who has no JavaScript: they
   will start, then stop at the first Continue.
4. **Advise an upgrade.** There is no configuration switch: the belt is unconditional and
   QCMS ships no variable that relaxes it. On desktop, any current browser works. On iOS,
   it takes an iOS update, because the browser app makes no difference.
5. **Tell us if it matters for your population.** The trade-off is tracked in issue #504,
   and the alternatives (a same-origin form token on the no-JS path, which does not depend
   on Fetch Metadata) are deliberately held until there is measured need rather than
   adopted in advance. A deployment that recruits respondents in one of the concentrated
   regions above is exactly the evidence that would move it.

#### The refusal line

Every belt refusal writes exactly one `warn` line to the portal's stdout, and an admitted
request writes none, so a count of these lines is a count of refused requests. One line per
refusal is a property of the belt itself rather than of the four route handlers, so a route
added later is covered without anyone remembering to instrument it.

```json
{
  "level": "warn",
  "time": "...",
  "service": "qcms-portal",
  "beltRoute": "/f/{formSlug}/start",
  "beltFetchSite": "absent",
  "beltOrigin": "null",
  "beltOutcome": "redirect-to-entry",
  "msg": "origin.belt.refused"
}
```

| Field           | What it holds                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beltRoute`     | Which route refused, as a path template: `/f/{formSlug}/start`, `/s/{sessionId}/answers`, `/s/{sessionId}/step` or `/s/{sessionId}/submit`                                              |
| `beltFetchSite` | How `Sec-Fetch-Site` read: `absent`, `same-site`, `cross-site`, or `other` for a token that is not one of the spec's four                                                               |
| `beltOrigin`    | How `Origin` read against the portal's own base URL: `absent`, `null`, `mismatch`, or `unverifiable` if `QCMS_PORTAL_BASE_URL` could not be read                                        |
| `beltOutcome`   | What the respondent got: `redirect-to-entry` (the "This form is not available" page), `redirect-to-step` (bounced back to the same step) or `forbidden` (a 403 to a hydrated `fetch()`) |

**Reading the two signals together is the point.** They separate the old browser from the
forged request, which is the distinction the absence of a log line could never make:

- `beltFetchSite: "absent"` with `beltOrigin: "null"` or `"absent"` is a **browser that
  sends no Fetch Metadata**: the population this whole runbook is about. On
  `/f/{formSlug}/start` or `/s/{sessionId}/step` that is almost certainly a real
  respondent who is now stuck.
- `beltFetchSite: "cross-site"` or `beltOrigin: "mismatch"` is a request that **named a
  foreign origin**. That is a forged POST or a misconfigured embed, and the belt did
  exactly its job.

**Measuring your own rate.** The accepted global floor is about 1.6% (see the estimate
above), but it is a global figure and not a measurement of your respondents. Count
`origin.belt.refused` lines with `beltFetchSite: "absent"` on `/f/{formSlug}/start`
against successful starts over the same window, and you have your deployment's actual
rate. That number is the evidence that would move the trade-off recorded in issue #504.

**What the line deliberately does not carry** (SEC-13). Every field above is a value from
a closed vocabulary chosen by the request, never a value written by it: no session id, no
form slug, no address, no answer, and no header value copied verbatim. `Origin` in
particular is attacker-controlled, so it is classified into the four outcomes in the table
and never recorded. A refusal line is therefore safe to ship to a log aggregator, and it
survives the OTLP export allowlist intact rather than collapsing to `application.event`.

**The admin writes this event too**, with the same name and the same four field names but
a different route vocabulary and a different meaning. If your grep is running over more
than one app's output, read the next runbook before drawing any conclusion from a count:
a refusal on the portal is usually an old browser, and a refusal on the admin usually is
not.

### Admin belt refusals: a stuck sign-in, or something probing the auth routes

**Symptom, in the case anyone reports.** A member of staff cannot sign in, cannot get past
the two-factor screen, or cannot change their password, and the screen shows the one
generic failure sentence with no further detail. Nothing in the admin's logs looks like an
error: the request was refused before it reached the API, so there is no failed
`auth.api.call` and no exception.

**The case nobody reports, which is why this runbook exists.** A cross-origin caller
posting at the admin's authentication routes is refused by the same belt and says nothing
to anyone. It is the same mechanism as the portal's and a different problem: the portal's
line makes an accepted loss countable, this one is the only trace an attempt against
sign-in, the two-factor challenge or the password change leaves anywhere.

Either way the first thing to look for is the same:

```
grep 'origin.belt.refused' <admin stdout>
```

**Cause.** All eight of the admin's state-changing BFF routes carry a CSRF belt (SEC-9,
`isSameOriginPost` in `apps/admin/lib/server/route-helpers.ts`). It admits a request that
either declares `Sec-Fetch-Site: same-origin` or `none`, or carries an `Origin` header
matching `QCMS_ADMIN_BASE_URL`. A request that can do neither is refused. As on the portal
this is unconditional and there is no variable that relaxes it.

**The refusal line.** Every belt refusal writes exactly one `warn` line to the admin's
stdout, and an admitted request writes none, so a count of these lines is a count of
refused requests. One line per refusal is a property of the belt itself rather than of the
eight route handlers, so a route added later is covered without anyone remembering to
instrument it.

```json
{
  "level": "warn",
  "time": "...",
  "service": "qcms-admin",
  "beltRoute": "/two-factor/challenge/verify",
  "beltFetchSite": "cross-site",
  "beltOrigin": "mismatch",
  "beltOutcome": "redirect-with-failure",
  "msg": "origin.belt.refused"
}
```

| Field           | What it holds                                                                                                                                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beltRoute`     | Which route refused, as a path template: `/sign-in/submit`, `/sign-out`, `/two-factor/challenge/verify`, `/two-factor/enroll/verify`, `/two-factor/recovery/verify`, `/two-factor/recovery-codes/confirm`, `/settings/password` or `/settings/recovery-codes`                                                                |
| `beltFetchSite` | How `Sec-Fetch-Site` read: `absent`, `same-site`, `cross-site`, or `other` for a token that is not one of the spec's four                                                                                                                                                                                                    |
| `beltOrigin`    | How `Origin` read against the admin's own base URL: `absent`, `null`, `mismatch`, or `unverifiable` if `QCMS_ADMIN_BASE_URL` could not be read                                                                                                                                                                               |
| `beltOutcome`   | `redirect-with-failure` (bounced back to the screen they were on, which renders its one generic sentence) or `redirect-without-message` (moved elsewhere with nothing said: a refused sign-out lands on the sign-in screen **while the session is still live**, and a refused recovery-code confirmation lands in the shell) |

#### Telling an admin refusal from a portal one

Both apps emit `origin.belt.refused` with the same four field names, so a grep across
aggregated logs returns them mixed together. Three ways to separate them, in the order you
should reach for them:

1. **The stdout line carries `service`.** `"service":"qcms-admin"` or
   `"service":"qcms-portal"`. This is the direct answer whenever you are reading raw
   lines, including `docker compose logs admin`, which separates them anyway.
2. **An exported record carries the resource, not the field.** `service` is a logger
   binding rather than an allowlisted attribute, so it is deleted on the way out under
   SEC-13. In an OTLP backend the app is the record's resource `service.name`, which is
   `OTEL_SERVICE_NAME` if you set it and otherwise `qcms-admin` or `qcms-portal`. Filtering
   an exported stream on a `service` **attribute** returns nothing at all, which reads
   exactly like "no refusals".
3. **`beltRoute` is disjoint between the two.** The portal's templates all begin `/f/` or
   `/s/`; the admin's are the eight auth and settings paths in the table above. This is the
   fallback when you have the line but not its provenance.

#### Reading an admin refusal

The fields read the same as the portal's. What is different is the base rate underneath
them, and that changes the conclusion rather than shading it:

- **On the portal there is an accepted population.** About 1.6% of browsers send no Fetch
  Metadata, that floor was accepted deliberately (issue #504), and `beltFetchSite:
"absent"` with `beltOrigin: "null"` or `"absent"` is very likely one of them.
- **On the admin there is no accepted population.** The admin is not a public surface: it
  is reached by a known, small set of staff. The same old-browser shape can occur here, but
  it is one identifiable person you can call rather than a rate you have to live with, and
  it is a one-off rather than a stream.

So:

- `beltFetchSite: "cross-site"` or `beltOrigin: "mismatch"` on **any** admin route is a
  request that named a foreign origin. Nothing legitimate produces that. One is a
  misconfigured embed or a stray bookmarklet; a **burst** is something probing you.
- A burst on `/sign-in/submit`, `/two-factor/challenge/verify` or
  `/two-factor/recovery/verify` in particular is an attempt against authentication, and it
  is the shape to act on. Read it beside the sign-in throttle (see "Checking that sign-in
  throttling is running" above), which counts attempts that got **past** the belt: the two
  together are the credential-attack picture, and neither half sees the other's requests.
- `beltFetchSite: "absent"` with `beltOrigin: "null"` or `"absent"` on
  `/sign-in/submit` is the old-browser shape. Ask that person their browser and version
  against the list in the previous runbook; the remedy is the same and there is no
  workaround equivalent to the portal's secure link.
- `beltOutcome: "redirect-without-message"` deserves a second look for what it is: nobody
  will ever report one, because nothing was said. A refused sign-out in particular leaves
  the session alive, so a staff member may believe they signed out on a shared machine when
  they did not.

**What you can do about it.** There is no configuration switch, by design: the belt is
unconditional and QCMS ships no variable that relaxes it. What the line supports is
detection and evidence. Count refusals per `beltRoute` over a window, keep the counts you
already have from before an incident, and if the source is reachable from your edge, block
it there. A refusal costs the caller nothing, so the belt will keep refusing for as long as
they keep asking; the line is what lets you know they are.

**What the line deliberately does not carry** (SEC-13). Every field above is a value from a
closed vocabulary chosen by the request, never a value written by it: no session token, no
email address, no TOTP code, no recovery code, no address, and no header value copied
verbatim. `Origin` in particular is attacker-controlled, so it is classified and never
recorded. That is what makes the line safe to ship to a log aggregator even though the
requests it describes are the ones carrying credentials, and it survives the OTLP export
allowlist intact rather than collapsing to `application.event`.

### Webhook dead-letters

Domain events (`response.submitted`, `form.published`) are written to the `outbox`
table in the same transaction as the state change they describe, then delivered by
the background deliverer with exponential backoff. Delivery is at-least-once, never
best-effort. After retries are exhausted a row is **dead-lettered**: `dead_lettered_at`
is set, `last_error` holds the reason, and the deliverer's claim query skips it
permanently (its partial index is `where dead_lettered_at is null`).

Dead-lettering is therefore a stable state that waits for a human, not a data loss
event. The payload is still there.

**Triage.**

1. List them: `GET /outbox/dead-letters` on the admin API returns dead-lettered
   deliveries with their attempt history. A form's recent delivery detail is at
   `GET /forms/{id}/deliveries`.
2. Read `last_error` and `attempts`. The common causes are a receiver that was down
   for longer than the backoff window, a receiver rejecting the HMAC signature
   (a rotated shared secret on their side), and a URL that has moved.
3. Fix the receiver first. Redelivery to a still-broken endpoint just dead-letters
   again, more slowly.
4. Redeliver: `POST /forms/{formId}/deliveries/{deliveryId}/redeliver` resets the row
   for immediate delivery. The form is required and enforced by the query (#305), and
   each dead-letter row carries its own `formId` for exactly this call, because the
   worklist spans forms.

**Which process delivers.** The deliverer runs only where the `internal` mount flag
is set. In the solo topology that is the single API process (`QCMS_MOUNT=all`). In
the segmented topology it is the internal instance only, and **running two copies of
the internal mount means two deliverers**: they claim with `FOR UPDATE SKIP LOCKED`
so they will not double-send a single row, but see `docs/deploy-enterprise.md` before
scaling that instance. If nothing is being delivered at all, check that some process
actually mounts `internal` before looking at the table.

### Erasure

Erasure is whole-session and is the **only** DELETE door in the system (ADR-17 as
amended). Answers are append-only everywhere else, so there is no partial-erasure
path to reach for and no UPDATE to fall back on.

1. Erase: `POST /forms/{formId}/responses/{sessionId}/erase` on the admin API, with a
   reason. The form is required and is enforced by the query, so naming the wrong one
   is refused exactly as an unknown session is (issue #305). It is
   **idempotent** and returns the tombstone, so a retry after a timeout is safe and
   does not need a "did it work" check first.
2. The tombstone is the compliance evidence, and it is what remains: `GET /erasures`
   lists them. A tombstone records that a session was erased, by whom and why, and
   never the content that was erased.
3. Confirm with `GET /erasures` rather than by looking for an absence.

Retention-driven expiry is separate and automatic: the retention sweep runs in the
process that mounts `internal`, on `QCMS_RETENTION_SWEEP_INTERVAL_MS`, and logs an
`expiredCount` each pass. A sweep that reports nothing over a long window when data
should be expiring is a sign the internal mount is not running anywhere.

The same pass also ages out webhook delivery **response snippets** and logs a
`redactedCount` when it removes any (a count only - logging one would defeat the
point of removing it). That column is the consumer's response body verbatim and can
carry a respondent's answers echoed back in a validation error, so it is the one part
of the attempt record with a lifetime: `QCMS_DELIVERY_SNIPPET_TTL_MS`, default 7 days.
`docs/erasure.md` has the rationale and the erasure-time behaviour.

The same pass also drops the **answers** an outbox event carries, logging its own
`redactedCount` (again a count only). `outbox.payload` for a `response.submitted`
event is a second full copy of the respondent's locked answers, kept so a delivery
can be re-sent, so it is kept exactly as long as re-sending is possible: once the
event and every delivery of it have settled for `QCMS_OUTBOX_PAYLOAD_TTL_MS`
(default 30 days), the answers go and the envelope stays. A delivery whose payload
has aged out can no longer be redelivered, and the endpoint answers `409
DELIVERY_NOT_REDELIVERABLE` if an operator tries. Set it to `0` to drop the answers
as soon as the fan-out settles, at the cost of ever redelivering.

### Secure-link key rotation

`QCMS_LINK_KEYS` is a **list**, and the list is the rotation mechanism: the first
entry signs every new link, and every entry verifies. `QCMS_SESSION_KEYS` works the
same way for session tokens. That is what makes rotation a zero-downtime change
rather than a mass invalidation.

To rotate without breaking links already in the wild:

1. **Prepend** the new key. The list becomes `new,current`. New links are signed with
   the new key; links signed with the old one still verify.
2. Restart the API instances so they pick up the new list. Both keys are live.
3. Wait out the longest link lifetime you have issued. Until that point, dropping the
   old key invalidates links respondents still hold.
4. **Remove** the trailing old key and restart again. The list becomes `new`.

Never reorder in place or replace the list in one step: replacing `current` with
`new` in a single edit invalidates every outstanding secure link at once, and the
symptom is respondents getting a rejection on a link that worked minutes earlier.

Key material is validated at boot for minimum length and the process refuses to start
on a short or empty key rather than starting with weak signing. The values are never
logged and never echoed in an error (SEC-8): a boot failure names the variable.

### Admin auth secret rotation

`QCMS_ADMIN_AUTH_SECRET` is not a list, and it is one of the two keys that protect data
at rest (the other is `QCMS_APP_KEY`, below): both stored second factors, the TOTP
secret and the recovery codes, are encrypted under it. So editing that variable in place is not a rotation - it makes
every enrolled authenticator unreadable, permanently, with no screen to re-enrol from.
**Never change it in place.**

Rotate through `QCMS_ADMIN_AUTH_SECRETS` instead. It is a list of
`<version>:<secret>` entries, newest first: the first entry encrypts everything
written from now on, and every entry can still read what it wrote. Stored material
carries the version that wrote it, and moves forward as it is used.

1. Generate a new secret (`openssl rand -base64 32`) and set
   `QCMS_ADMIN_AUTH_SECRETS=2:<new>,1:<current>`. Leave `QCMS_ADMIN_AUTH_SECRET` set
   to `<current>`: it stays the fallback for material written before this list existed.
2. Restart the API. **Every administrator is signed out** - the session cookie is
   signed with the current version - and they sign in again as normal, second factor
   included. That is the whole visible impact.
3. Recovery codes migrate on their own: each redemption re-encodes the remaining set
   under the current version. TOTP secrets do **not** - they are written once at
   enrolment and only read afterwards.
4. Because of step 3, **keep the old version in the list**. A TOTP secret written
   under version 1 stays readable only while version 1 is listed, and the launch admin
   surface exposes no way to re-enrol an account that already has a live factor
   (`two-factor/disable` is deliberately unmounted). So at launch a retired version is
   retired for good and there is no supported path to drop the trailing entry: add
   versions, do not remove them. Pruning becomes possible when a 2FA reset exists
   (issue #432).

A fourth limit is not conditional on rotating at all: **the deploy that introduced this
list is a one-way door.** From that release onward every piece of stored two-factor
material is written in the versioned `$ba$<version>$<hex>` envelope, whether or not
`QCMS_ADMIN_AUTH_SECRETS` is ever set, because the default is a version-1 list rather
than no list. A build from before the change knows nothing about that envelope: it hands
the whole string to a raw hex decode (`rawDecrypt` -> `hexToBytes`), which throws rather
than returning wrong plaintext. So rolling the API image back past this change leaves
every account enrolled since the deploy unverifiable on both factors, while accounts
enrolled before it keep working through the same code path they always used. Roll
forward from a fault here rather than back, and if a rollback has to stay available,
take the database snapshot before the upgrade and treat restoring it as part of the
rollback.

Numbering: versions are integers, unique, and are **not** positional - they identify
the key inside the stored ciphertext, so never renumber an existing key. Add a higher
number at the head of the list and leave the older ones alone.

If the secret is lost outright there is currently no break-glass: nothing resets an
account's 2FA state, so both factors are gone with the key. That gap is tracked
separately (issue #432); until it closes, treat this secret with the same care as the
database it protects, and back the two up together.

### App encryption key: there is no in-place rotation

`QCMS_APP_KEY` is neither a list like `QCMS_LINK_KEYS` nor a versioned set like
`QCMS_ADMIN_AUTH_SECRETS`. It is a single scalar, there is no re-encrypt job, and the
stored envelope carries a scheme version (`v1.`) but no key id, so nothing in the
database records which key encrypted a given row. **Set it once and back it up with the
database** (`docs/backup-restore.md`). There is no procedure below for rotating it on a
schedule, because none exists.

What it protects is one column, `webhooks.secret_encrypted`, holding the per-webhook
HMAC signing secret. So changing the value makes every stored webhook secret
undecryptable at once. The failure is visible rather than silent: the delivery
scheduler records `secret_decrypt_failed`, and those deliveries dead-letter where the
Webhooks page lists them.

**What separates this from the admin auth secret above is that it is recoverable
without the old key.** The webhook secret is server-generated and can be replaced
without ever reading the old one. So if the key has already changed, or has to change
because it was exposed, the way back is:

1. Roll the new `QCMS_APP_KEY` out to every service that carries it
   (`docs/deploy-enterprise.md` lists them) and restart. Deliveries dead-letter from
   here until each endpoint has been through step 2.
2. For each form, open its **Webhooks** page in the admin and press **Rotate secret**
   on every endpoint listed. That mints a fresh secret under the current key without
   reading the old ciphertext. Include endpoints showing as inactive: the button is
   offered for those too, and reactivating one later would otherwise bring back an
   undecryptable secret.
3. Hand each consumer its new secret, out of band, and wait for them to deploy it.
   This is the step that costs real time, and it is the reason to treat the key as
   set-once rather than as something to rotate on a schedule.
4. Redeliver the dead-lettered deliveries once the consumers are verifying again. That
   is **not** on the per-form page from step 2: the dead-letter queue is
   deployment-wide, so it lives on the **Webhooks** area page in the main nav
   ("Webhook operations").

The cost of a key change is therefore re-coordinating a shared secret with every
webhook consumer, plus the deliveries that dead-lettered in between, which are
redeliverable. **It is not data loss**, and a restore that comes up on a different key
is not an unrecoverable restore. Making this an accepted-list key, so that a re-encrypt
pass could run online and skip the dead-letter window entirely, is Phase 4 work
(issue #466).

## Backups

Policy, schedule guidance, the restore procedure and the automated restore drill are
in `docs/backup-restore.md`. The one line that belongs here: a backup nobody has
restored is not a backup, which is why the drill is a script (`pnpm qcms:drill-restore`)
and runs in CI rather than living in a document as an instruction.
