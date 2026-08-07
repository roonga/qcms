# Enterprise deployment recipe

**Audience:** an operator running QCMS where the respondent portal is on the public internet and authoring is not. **Prerequisite reading:** `docs/deploy-ingress.md` (TLS and routing, ADR-20) and `docs/operations.md` (the generated per-variable environment reference, health semantics, and runbooks).

The enterprise topology runs the **same three images** as the solo `docker-compose.yml`. Nothing is rebuilt, no flag is compiled in, and no separate "worker" image exists. What changes is **instance count and one environment variable**: the API is deployed twice, once mounting the respondent surface and once mounting the authoring surface plus the background schedulers (`docs/ARCHITECTURE.md` §9).

## 1. The two API instances

| | `api-public` | `api-internal` |
|---|---|---|
| Image | `qcms-api` (identical) | `qcms-api` (identical) |
| `QCMS_MOUNT` | `public` | `internal,admin` |
| Route groups mounted | `/` (start session, serve step, submit) | `/internal` (empty today), `/admin`, `/api/auth` |
| Background schedulers | none | outbox deliverer + retention sweep |
| Callers | portal BFF only | admin BFF only |
| Network | internal side of the public zone | authoring zone, never routable from the internet |
| Horizontal scaling | free (see §5) | scheduler singleton caveat (see §5) |

Solo, for contrast, is one process with `QCMS_MOUNT=all`, which `parseMount` expands to all three surfaces, so the single container serves every route **and** owns the schedulers. That is the only reason solo needs no split: the shortcut exists so a four-container deployment does not have to enumerate surfaces.

### What "not mounted" actually means

An unmounted group has **no routes registered**, so a request to it is a `404` and not a `403` (ADR-09). `POST /admin/forms` against `api-public` does not fail authorization, it fails routing: the handler is not in that process. This is a build-time isolation guarantee rather than a policy check, which is why it is stated as a topology control in `docs/SECURITY_DESIGN.md` §2.3 rather than as an authorization rule.

Two consequences worth planning around:

- **`api-public` has no identity provider at all.** `/api/auth/*` rides the `admin` flag (`apps/api/src/app.ts:140`), so a sign-in request to the public instance is a 404. A credential-stuffing run against the public origin has nothing to reach.
- **`api-public` is never given `QCMS_ADMIN_AUTH_SECRET`.** The better-auth configuration is parsed only when the admin surface is mounted (`apps/api/src/config.ts:636`), so the secret that protects stored two-factor material simply is not present in the process that faces the internet. Do not put it in a shared environment file that both instances read.

### Be honest about `internal`

**The `internal` route group carries no slices today** (`apps/api/src/registrars.ts:45` is an empty list). Mounting `internal` therefore registers an empty group under `/internal` and its real, present-day effect is **scheduler ownership**: `apps/api/src/main.ts:74` starts the retention sweep and the outbox deliverer if and only if `config.mount.internal` is set. Read `internal` as "this process runs the background work", not as "this process serves internal HTTP endpoints". The group exists so that when internal-only endpoints arrive they land on a surface that is already deployed, already token-gated, and already off the public path.

Both API instances still serve `/health` and `/ready`: those are registered unconditionally, above the mount logic (`apps/api/src/app.ts:110`), so every process shape is probeable by an orchestrator.

## 2. Network segmentation

```
                          PUBLIC ZONE
 ┌───────────────────────────────────────────────────────────────┐
 │                                                               │
 │  internet ──[B1]──▶  ingress (TLS, HSTS, body cap)            │
 │                            │                                  │
 │                            │ routes portal ONLY               │
 │                            ▼                                  │
 │                      portal (SSR + BFF)                       │
 │                            │                                  │
 └────────────────────────────┼──────────────────────────────────┘
                              │ [B2] internal network,
                              │      x-qcms-internal-token (SEC-4)
                              ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                     INTERNAL / AUTHORING ZONE                 │
 │                     (VPN or private network; no public route) │
 │                                                               │
 │                      api-public                               │
 │                   QCMS_MOUNT=public                           │
 │                            │                                  │
 │   authors ──[B4: VPN]──▶ admin (BFF)                          │
 │                            │ [B2] internal token              │
 │                            ▼                                  │
 │                     api-internal                              │
 │              QCMS_MOUNT=internal,admin                        │
 │              + outbox deliverer + retention sweep             │
 │                            │                                  │
 └────────────────────────────┼──────────────────────────────────┘
                              │ [B3] credentialed, private
              ┌───────────────┴───────────────┐
              ▼                               │
 ┌───────────────────────────────────────┐    │
 │              DATA ZONE                │    │
 │        postgres (the only state)      │◀───┘  both API instances,
 └───────────────────────────────────────┘       one database

 egress: api-internal ──[B5]──▶ webhook consumers (outbound only, signed)
```

Boundary labels are `docs/SECURITY_DESIGN.md` §1's. What this diagram commits you to:

- **Only the portal is published.** The ingress routes the portal origin, and in this topology it routes nothing else. Neither API instance publishes a host port (ADR-20); they are reachable only from the BFF that calls them.
- **The admin app is on the VPN or private network, never the public internet.** In solo, admin is protected by TLS plus better-auth two-factor because there is nowhere else to put it (ADR-20's consequence, anticipated by boundary B4). Enterprise takes the network option: authors reach the admin origin over the VPN, and the same two-factor controls still apply behind it. B4 is a network boundary here, not only an authentication one.
- **Nothing crosses from the public zone to `api-internal`.** The portal BFF calls `api-public` and only `api-public`. There is no path from a respondent request to the authoring surface, in either direction.
- **Both API instances reach one Postgres.** That shared database is what makes the split work at all: a link minted on `api-internal` is redeemed on `api-public`, and the response written by `api-public` is exported from `api-internal`. Nothing is replicated between the instances.
- **The BFFs are the only API clients.** Browsers never talk to the API (R2). The SEC-4 internal token authenticates the channel, never the user: end-user authorization is always the forwarded admin session or respondent session token.
- **Webhook delivery is outbound from `api-internal`.** Egress filtering belongs on that zone. `QCMS_WEBHOOK_ALLOW_PRIVATE` is the switch that decides whether internal targets are even accepted (SEC-6); leave it `false` unless the deployment genuinely posts to on-prem systems.

The images listen on 3000 inside the container and Compose never republishes that. Host ports for any human-facing publish come from the allocation in `docs/PORTS.md` (R8); nothing in this recipe invents one.

## 3. Environment matrix per process

**This table answers "which process gets which variable", nothing more.** The authoritative per-variable detail (meaning, default, secret status, validation) is the generated reference in `docs/operations.md`, which is derived from `apps/api/src/config.ts` and asserted against it, so it cannot drift. Read that first, then use this table to place each value.

Legend: **req** required (boot fails without it) · opt optional · cond required only under the stated condition · `-` not read by that process.

| Variable | portal | admin | api-public | api-internal | postgres |
|---|---|---|---|---|---|
| `DATABASE_URL` | `-` | `-` | **req** | **req** | its own credential |
| `QCMS_MOUNT` | `-` | `-` | **req** = `public` | **req** = `internal,admin` | `-` |
| `QCMS_INTERNAL_TOKEN` | **req** | **req** | **req** | **req** | `-` |
| `QCMS_LINK_KEYS` | `-` | `-` | **req** (verifies) | **req** (signs) | `-` |
| `QCMS_SESSION_KEYS` | `-` | `-` | **req** | **req** | `-` |
| `QCMS_APP_KEY` | `-` | `-` | **req** | **req** | `-` |
| `QCMS_PORTAL_BASE_URL` | **req** | `-` | **req** | **req** | `-` |
| `QCMS_API_BASE_URL` | **req** | **req** | `-` | `-` | `-` |
| `QCMS_ADMIN_BASE_URL` | `-` | **req** | `-` | **req** | `-` |
| `QCMS_ADMIN_AUTH_SECRET` | `-` | `-` | `-` | **req** | `-` |
| `QCMS_SECURE_COOKIES` | opt | `-` | `-` | `-` | `-` |
| `QCMS_ADMIN_SECURE_COOKIES` | `-` | opt | `-` | opt | `-` |
| `QCMS_ADMIN_2FA` | `-` | opt | opt | opt | `-` |
| `QCMS_ADMIN_SESSION_MAX_AGE_MS` | `-` | opt | opt | opt | `-` |
| `QCMS_ADMIN_SESSION_IDLE_MS` | `-` | `-` | `-` | opt | `-` |
| `QCMS_FLAG_CHALLENGE_PROVIDER` | opt | `-` | opt | leave unset | `-` |
| `QCMS_TURNSTILE_SITE_KEY` | cond | `-` | `-` | `-` | `-` |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | `-` | `-` | cond | `-` | `-` |
| `QCMS_SESSION_TTL_MS` | `-` | `-` | opt | opt | `-` |
| `QCMS_RL_*` (8 rate-limit knobs) | `-` | `-` | opt | opt | `-` |
| `QCMS_ANTIABUSE_MIN_SUBMIT_MS` / `_HONEYPOT_FIELD` | `-` | `-` | opt | opt | `-` |
| `QCMS_WEBHOOK_ALLOW_PRIVATE` / `_TIMEOUT_MS` / `_BATCH_SIZE` | `-` | `-` | opt | opt | `-` |
| `QCMS_OUTBOX_INTERVAL_MS` / `_JITTER_MS` | `-` | `-` | opt | opt | `-` |
| `QCMS_RETENTION_SWEEP_INTERVAL_MS` | `-` | `-` | opt | opt | `-` |
| `QCMS_BODY_LIMIT_BYTES` | `-` | `-` | opt | opt | `-` |
| `QCMS_READY_DB_TIMEOUT_MS` | `-` | `-` | opt | opt | `-` |
| `QCMS_PORTAL_THEME` / `_MODE` / `_CORNERS` / `_DENSITY` / `_FONT` / `_FONTS` / `_BRAND_NAME` / `_BRAND_LOGO` | opt | `-` | `-` | `-` | `-` |
| `PORT` (alias `QCMS_PORT`) | `-` | `-` | opt | opt | `-` |
| `NODE_ENV` | opt | opt | opt | opt | `-` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | opt | `-` | opt | opt | `-` |
| `QCMS_ADMIN_EMAIL` / `QCMS_ADMIN_PASSWORD` / `QCMS_ADMIN_NAME` | `-` | `-` | `-` | bootstrap only | `-` |

### Reading the matrix

**`loadConfig` validates the whole API surface in every API process**, so an optional knob is *parsed* on both instances even when only one of them acts on it. The rows above say where a value is **read**; the table below says where it has an **effect**. Setting an inert knob is harmless; forgetting one on the instance that acts on it is not.

| Knob | Effective on | Why (verified) |
|---|---|---|
| `QCMS_OUTBOX_*`, `QCMS_RETENTION_SWEEP_INTERVAL_MS` | `api-internal` only | the schedulers start under `if (config.mount.internal)`, `apps/api/src/main.ts:74` |
| `QCMS_WEBHOOK_*` | `api-internal` only | read by the admin webhook-config handler and the delivery pass, both internal-side |
| `QCMS_ADMIN_SESSION_MAX_AGE_MS`, `QCMS_ADMIN_2FA` | `api-internal` (and the admin app) | consumed by the admin-auth middleware, which exists only where `/admin` is mounted |
| `QCMS_RL_*`, `QCMS_ANTIABUSE_*`, `QCMS_SESSION_TTL_MS` | `api-public` | the respondent loop (start session, answers, submit) is the public group |
| `QCMS_LINK_KEYS` | both | `api-internal` signs with the first key, `api-public` verifies against all of them |

- **The challenge provider belongs to the public pair.** `parseChallenge` demands `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` whenever `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`, unconditionally on mount. Setting that flag in a shared environment file therefore makes `api-internal` refuse to boot until it is also handed challenge secrets it will never use. Set the flag on `api-public` and the portal; leave it unset on `api-internal`.
- **An unknown `QCMS_FLAG_*` variable fails boot** (ADR-24), on every instance that sees it. A typo in a shared environment file is a full outage, not a silently ignored line.
- **Values that must be byte-identical across processes:** `QCMS_INTERNAL_TOKEN` (or at least, the BFF's token must appear in the API's accepted list), `QCMS_ADMIN_BASE_URL` between admin and `api-internal` (better-auth compares origins by string equality), `QCMS_ADMIN_SECURE_COOKIES` between admin and `api-internal` (they set different cookie families on one origin, and a disagreement makes sign-in loop), and `QCMS_ADMIN_2FA` between admin and `api-internal`.
- **`QCMS_PORTAL_BASE_URL` is required on both API instances** even though only the authoring one mints link URLs: it is validated unconditionally. Give both the same public portal origin.
- **Neither BFF holds a database credential.** The API is the only process in either topology with a `DATABASE_URL` (ADR-35 as amended, implemented by task 056). If a deployment template hands the admin one, that is a regression, not a convenience.
- **Postgres** takes its own server configuration, not QCMS variables. In enterprise it is usually a managed instance rather than a container, which is why the column names a credential instead of a variable list. It is the only stateful component (`docs/ARCHITECTURE.md` §10), so it is the whole of the backup story (`docs/backup-restore.md`).

## 4. Bootstrap and upgrade order

Migration is a deliberate, separate step rather than migrate-on-boot, precisely because this topology runs more than one API process: a boot-time migration in an N-instance deployment is N racing migrators, and the adopter loses the ability to decide when schema change happens. So:

1. Run the migration once, from the API image (`node node_modules/@qcms/db/dist/migrate.js`), against the database, with nothing else starting.
2. Start or restart `api-internal`, then `api-public`, then the two front ends.
3. Create the first administrator once, against `api-internal`'s image, with `QCMS_ADMIN_EMAIL` and `QCMS_ADMIN_PASSWORD` supplied per-command rather than in a stored environment file. There is no self-registration path in any composition (SEC-1), so this command is the only door.

The full upgrade procedure and the runbooks (webhook dead letters, erasure, secure-link key rotation) are in `docs/operations.md`.

## 5. Scaling, and who owns the schedulers

**`api-public` scales horizontally with no coordination.** It mounts no schedulers, holds no cross-request state that matters, and every instance verifies the same link and session keys. Put N of them behind the portal's internal service address and add or remove instances freely. Two caveats, both pre-existing rather than introduced by the split:

- The rate-limit store is in-process by default (`InMemoryRateLimitStore`, `apps/api/src/main.ts:64`), so per-IP and per-session limits are enforced **per instance**. With N instances the effective ceiling is N times the configured one. A shared store is the documented swap (task 017's seam); until then, divide the configured maxima by the instance count, or enforce the outer limit at the ingress.
- Respondent sessions live in Postgres, not in memory, so any instance can serve any step. No sticky routing is required.

**`api-internal` is a scheduler singleton by convention, and you should treat it as one.** `main.ts:74` starts the retention sweep and the outbox deliverer in **every** process whose mount includes `internal`. Run two copies of `QCMS_MOUNT=internal,admin` and you have two deliverers and two sweeps, not one work queue with two workers by configuration. Concretely:

- The outbox deliverer claims rows with `FOR UPDATE SKIP LOCKED` (`docs/ARCHITECTURE.md` §5.3), so two deliverers do **not** double-deliver a webhook. Delivery is at-least-once and stays correct.
- What you do get is doubled polling pressure on the outbox table and doubled sweep passes, for no throughput you asked for. `QCMS_OUTBOX_JITTER_MS` exists so multiple instances do not tick in lockstep, which bounds the collision cost but does not make the extra instance useful.
- If the authoring surface itself needs more capacity (a large export, many concurrent authors), the clean split is a third instance with `QCMS_MOUNT=admin` **only**: it serves `/admin` and `/api/auth` and starts no schedulers, because the scheduler condition is `mount.internal`. Keep exactly one process carrying `internal`.

That last point is the single most load-bearing operational fact in this document: **`internal` is the scheduler flag.** Scale the admin surface by adding `admin`-only instances; never by adding `internal` ones.

## 6. Verifying this matches the code

Every claim above is checkable against a file in this repository, and two of them are checked by tests.

**The split topology itself** is a scenario in the 027 end-to-end suite: `apps/api/e2e/04-mount-split.e2e.ts`. It composes two apps over **one** database and **one** environment, exactly as this recipe deploys them, and asserts the properties the recipe depends on:

- `/admin/forms` on the public composition answers `404`, not `403`.
- `POST /sessions` on the authoring composition answers `404`.
- A link minted on the authoring composition is redeemed on the public one, the respondent submits there, and the authoring composition exports the resulting response. That only works because both share the database and the signing keys.

The suite composes with `MountFlags` **objects** from `apps/api/e2e/support/harness.ts:36-40`, not with `QCMS_MOUNT` strings, so it verifies the process shapes rather than the spelling. The spelling is verified separately, in `apps/api/src/config.test.ts:8` (`QCMS_MOUNT: "public,internal"` parses to the matching flag object) and `:17` (`all` sets every surface). Together those two tests are the evidence for the strings this recipe documents:

| Recipe instance | Documented value | Flags it produces | Harness preset it matches |
|---|---|---|---|
| `api-public` | `QCMS_MOUNT=public` | `{public: true, internal: false, admin: false}` | `MOUNT.publicOnly` |
| `api-internal` | `QCMS_MOUNT=internal,admin` | `{public: false, internal: true, admin: true}` | `MOUNT.adminOnly` |
| solo | `QCMS_MOUNT=all` | `{public: true, internal: true, admin: true}` | `MOUNT.all` |

Note that the harness calls the second preset `adminOnly` while it sets `internal: true` as well. The name is about the *routes* it serves; the `internal` flag in it is what puts the schedulers there. This recipe names that instance `api-internal` for exactly that reason.

**The unpublished-API property** is asserted against the merged Compose configuration by `scripts/compose-config.test.ts`, so "the API container publishes no host port" is a tested property of the shipped files rather than a convention.

If a future change adds slices to the `internal` registrar list (`apps/api/src/registrars.ts:45`), §1's "the internal group carries no slices" paragraph is stale and must be corrected in that same change.
