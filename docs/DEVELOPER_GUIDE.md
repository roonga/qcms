# QCMS - Developer Guide

> **Methodology vs. runbook:** this is the _operator's runbook_ - how to drive the build day-to-day. For the _why_ (principles, task-design rules, the session protocol, the audit checklist) see [`AGENTIC_DEVELOPMENT.md`](AGENTIC_DEVELOPMENT.md).

How to drive the QCMS single-seat agent workflow as the human in the loop. Agent instructions live in `CLAUDE.md` and `PROJECT_INSTRUCTIONS.md`.

## Launching

**The canonical seat is inside the dev container (ADR-29).** The container is the blast radius, which is what makes `bypassPermissions` a responsible default for the loop rather than a gamble.

```sh
# From the repo root on the host (WSL2/Linux/macOS):
pnpm devcontainer up        # build/start (first run: several minutes)
pnpm devcontainer shell     # a zsh terminal inside; repeat for more terminals
pnpm devcontainer status     # what is running, and whether the config drifted
pnpm devcontainer rebuild    # REQUIRED after editing devcontainer.json
pnpm devcontainer run 'pnpm build'   # one command inside, then exit
pnpm devcontainer stop       # there is no `devcontainer down`
# or, in VS Code: "Reopen in Container" and use the integrated terminal.

# Then, inside the container:
claude                                      # normal session - repo defaults to acceptEdits mode
claude --permission-mode bypassPermissions  # fully unattended: safe here, because "here" is the container
```

The host seat still works exactly as before (nothing about it changed):

```sh
cd <your qcms checkout>
claude
claude --permission-mode bypassPermissions  # only in a checkout you trust the agent with
```

Full guide: [`DEV_CONTAINER.md`](DEV_CONTAINER.md). `pnpm devcontainer` wraps the `@devcontainers/cli` lifecycle (falling back to `pnpm dlx`, so no global install is needed) and covers the trap that route has: **`up` silently reuses a running container and ignores changed `runArgs`, `appPort` and `containerEnv`.** `status` and `shell` warn when `devcontainer.json` is newer than the running container, and `rebuild` is the fix. Working without the wrapper is fine too - it is `devcontainer up --workspace-folder .`, plus `--remove-existing-container` to force a real recreate.

Modes: the repo's `.claude/settings.json` sets **acceptEdits** (file edits and allowlisted commands run without prompting; anything unusual still asks). Shift+Tab cycles modes mid-session. For zero prompts, use the bypass flag above.

**What the container gives the loop:** Node 24 + pnpm at the pinned version, Docker (the host daemon, mounted in) so Testcontainers works, the GitHub CLI, Playwright's Chromium with its OS libraries, zsh, and the Claude Code CLI. `CLAUDE_CONFIG_DIR` points at the mounted `~/.claude`, which puts `.claude.json` (the account/OAuth state) inside the mount too, so your host login carries straight into the container and survives rebuilds. Verified in task 046: `claude -p "..." --permission-mode bypassPermissions` runs headless inside the container, already authenticated, with zero prompts.

**Trust the workspace once for interactive sessions.** A fresh container prints `Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted`. Under `bypassPermissions` this is harmless (nothing is being gated), but an _interactive_ session in the container will keep asking until you accept the trust dialog once, or set `projects["/workspaces/<folder>"].hasTrustDialogAccepted: true` in `~/.claude/.claude.json`.

**Ports: the allocation lives in [`docs/PORTS.md`](PORTS.md).** That is the only table, and it is binding (R8, ADR-37): `7Sxx` for stable human-facing services, `17Sxx` for ephemeral test harnesses, seat `S` from `QCMS_PORT_SEAT` and defaulting to 0. The numbers below are seat 0, which is the default and what every existing setup already runs. Nothing here restates the table; go there to add or move anything.

**Viewing the app from your host browser:** the dev servers listen on all interfaces inside the container (`next dev` and the Hono `serve()` both bind `0.0.0.0` by default, verified by the listen socket). The ports the container serves, **7000, 7010, 7030 and 7040**, leave it via `appPort` (published on the Docker host by **any** launcher, including a bare CLI `devcontainer up`) plus `forwardPorts` (the VS Code / Codespaces editor tunnel). `http://localhost:7000` on the host reaches the portal on either route: measured `200` from the host against a CLI-launched container running `pnpm exec next dev --port 7000`.

**Design previews over HTTP (7030 at seat 0):** `pnpm artifacts` starts a read-only, dependency-free static server (`scripts/serve-artifacts.mjs`) for files under `plan/`. Open `http://localhost:7030/plan/`. The port leaves the container through `appPort` and `forwardPorts`; rebuild older containers if it is not published.

**7020 belongs to the host.** The dev Postgres from `docker-compose.dev.yml` publishes 7020 on the host, so the container must _not_ claim it - if it did, whichever of the two started second would fail to bind. The container reaches it over the host gateway instead:

```sh
docker compose -f docker-compose.dev.yml up -d
pnpm dev:portal   # finds the dev DB itself; see CONTRIBUTING for why not host.docker.internal
```

**`QCMS_DOCKER_PUBLISH_HOST` overrides that detection**, and it is the one escape hatch on this path. `scripts/docker-host.mjs` answers "which host is a Docker-published port on, as seen from _this_ process": `localhost` on a plain host checkout and on CI, and the container's default-route gateway inside the dev container, because publishing binds on the Docker host and inside the container that host is another machine. Set the variable and that answer is taken as given, before anything is probed:

```sh
QCMS_DOCKER_PUBLISH_HOST=172.17.0.1 pnpm dev:portal
```

Reach for it when the detection is wrong for your setup - an unusual routing table, a rootless or remote daemon, a gateway that is not the host. It is worth knowing about because of what it reaches: the same value picks the **database host** `pnpm dev:portal` and `pnpm dev:admin` dial (one script, `scripts/dev-stack.mjs`), so a wrong value there looks like a dev server that cannot find Postgres rather than like a misread route. The full-stack Compose harness does **not** use it (it joins the Compose network and forwards this container's loopback instead, `docs/PORTS.md`), so setting it changes nothing about `pnpm up:e2e`.

**Running the admin app: `pnpm dev:admin`.** It is `pnpm dev:portal`'s twin (same script,
`scripts/dev-stack.mjs`): dev database up and migrated, kitchen-sink form seeded, API
started, then the admin on seat 0's **7040**. Both children get the _same_ freshly
generated SEC-4 internal token, which is why the admin cannot simply be pointed at an API
someone else started: that token exists only in the launching process's memory and is
written nowhere (issue #281). The cost is that `dev:admin` and `dev:portal` each start an
API on 7010 and so cannot share a seat: give the second one `QCMS_PORT_SEAT=1`.

One extra step the portal does not need: the admin has no self-registration path (SEC-1),
so the deployment's first account comes from a command. Since task 056 the admin itself
holds no database handle - better-auth lives in the API - so that bootstrap command is an
**API-side** one and takes the API's env, not the admin's.

```bash
# Pin the auth secret for the whole shell session, BEFORE `pnpm dev:admin` starts the
# API - an unpinned restart destroys an existing TOTP enrolment, see below. Any value
# >= 32 chars with no whitespace or commas. `pnpm dev:admin` warns when it is unset.
export QCMS_ADMIN_AUTH_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")

pnpm dev:admin        # dev DB + API + admin on http://localhost:7040

# In a second terminal, once only, if this database has no admin yet. The launcher
# prints this command with the values already filled in.
#
# Prompt for the passphrase rather than typing it inline: an inline assignment keeps
# the value out of `ps` but writes it straight to your shell history (issue #460).
read -rs -p 'passphrase: ' QCMS_ADMIN_PASSWORD; echo
export QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD

DATABASE_URL=postgres://qcms:qcms@127.0.0.1:7020/qcms \
  QCMS_ADMIN_BASE_URL=http://localhost:7040 \
  QCMS_ADMIN_AUTH_SECRET=$QCMS_ADMIN_AUTH_SECRET \
  pnpm qcms:create-admin

unset QCMS_ADMIN_PASSWORD
```

7040 leaves the dev container the same way 7000/7010/7030 do (`appPort` + `forwardPorts`),
and it was added to that list later than the rest: a container created before then
publishes it only after `pnpm devcontainer rebuild`.

`QCMS_ADMIN_AUTH_SECRET` is required here because `loadConfig` validates it, but for
_this command_ it does **not** have to match the running API's: `create-admin` creates an
account (salted password hash, secret-independent) and enrols no second factor, and it
revokes the one session it mints, so nothing it writes is ever decrypted by another
process.

**Pin `QCMS_ADMIN_AUTH_SECRET` in your environment before you enrol, though.** It is the
key better-auth encrypts the stored TOTP secret under, so changing it does not just
invalidate cookies - it makes an existing enrolment permanently unverifiable. Checked
against the source of better-auth 1.7.2, the pinned version, rather than inferred:
`two-factor/enable` stores
the secret with `symmetricEncrypt({ key: ctx.context.secretConfig, ... })`
(`dist/plugins/two-factor/index.mjs:134`) and every verification decrypts with the
_current_ key (`dist/plugins/two-factor/totp/index.mjs:188`, and `:122` for the URI
reveal). `pnpm dev:portal` and `pnpm dev:admin` generate a fresh secret when the variable
is unset, so an unpinned restart leaves your authenticator's codes rejected for good.
`pnpm dev:admin` says so on startup rather than leaving you to remember it.

**Nothing is left in that state, including the recovery codes.** This guide used to say
the ten recovery codes survive an unpinned restart because better-auth stores them as
plain JSON - that was wrong (issue #319). The plugin defaults `storeBackupCodes` to
`"encrypted"` (`dist/plugins/two-factor/index.mjs:25-27`; the decoder
`getBackupCodes` at `.../backup-codes/index.mjs:44` takes its encrypted branch on `:45`
and falls through to the plain-JSON `return safeJSONParse(backupCodes)` on `:50` only
when a caller _overrides_ the default), so
the codes are ciphertext under the same key as the TOTP secret and die with it. There is
no re-enrolment screen and no 2FA reset command (issue #432), so the fastest way out of a
lost dev secret is a fresh database. Setting `QCMS_ADMIN_2FA=optional` afterwards does not
rescue it: the challenge is demanded whenever the account's `twoFactorEnabled` is true.

For a **deployment**, the answer is not to lose the secret and not to change it in place:
rotate it through `QCMS_ADMIN_AUTH_SECRETS`, a versioned list where the newest entry
encrypts and older entries keep reading, so a key change costs a round of sign-ins rather
than every enrolment (`docs/operations.md`, "Admin auth secret rotation").

The command refuses to run once any admin account exists, so it is safe in a runbook and
safe to re-run by accident. On first sign-in you must enroll a TOTP factor before reaching
anything else, and the recovery codes are shown once. `QCMS_ADMIN_2FA=optional` skips
enrollment for development; the API reads the same variable, so relaxing it in one place
only means every admin API call 401s. The admin adopts the same `.next` / `.next-dev`
split described next, from day one.

**Where the portal's build output lands:** the production build (`pnpm build`, served by `next start`) writes `apps/portal/.next`; every dev server (`pnpm dev:portal`, and the one the Playwright suite boots) writes `apps/portal/.next-dev`. Two directories, deliberately (issue #54): `turbo.json` declares the portal build's outputs as `.next/**`, so while dev output lived under `.next` it was tarred into the build cache and a later `pnpm build` cache hit restored that stale snapshot, from any worktree, over the live dev directory. The dev server then died on a corrupt or stale Turbopack cache and the only visible symptom was a bare 180s Playwright `webServer` timeout. Split, `pnpm build` and `pnpm exec playwright test` work in either order with no manual clean. Both directories are gitignored, and `rm -rf apps/portal/.next-dev` is always safe: it discards no production build. That glob now also excludes `.next/dev` and `.next/cache` (issue #57), so the artifact holds only what `next build` produced.

**A turbo `outputs` glob must match only files the build itself writes.** turbo tars whatever matches when a task ends, so anything else that lives in those paths (a dev server's directory, a runtime cache, a log) is captured and restored over the live copy on the next cache hit, in any worktree.

If a Testcontainers-backed suite cannot reach the container it just started (sibling containers, not children), set `TESTCONTAINERS_HOST_OVERRIDE`. It has never been needed here. Prefer the default-route gateway over `host.docker.internal` if you do need it, for the Postgres-session reason noted above.

**Testcontainers behaves differently locally and on CI, in exactly one way (issue #150).** The Ryuk reaper (Testcontainers' cleanup sidecar, image `testcontainers/ryuk`) runs **locally** and is **disabled on CI** via `TESTCONTAINERS_RYUK_DISABLED=true`, set by `.github/actions/test-postgres-image` for every Testcontainers job:

- **Why disabled on CI:** its image is the one thing `QCMS_TEST_POSTGRES_IMAGE` does not redirect, so it was still pulled from Docker Hub after the #74 GHCR mirror landed, and a Hub timeout on that pull failed PR #149's `portal-e2e` leg while the mirror worked perfectly. A runner is an ephemeral VM destroyed with the job, so nothing needs reaping. The trade accepted: on CI no process owns container cleanup after a crashed run.
- **Why kept locally:** your machine is long-lived. Kill a Vitest run mid-flight without Ryuk and its Postgres containers keep running until you clean them up by hand.
- **Do not put that variable in a committed `.env` or in `vitest.config.ts`** - both would follow developers and take Ryuk away from the machines that need it. If you want it locally for one run, export it in that shell only.
- The paired `.github/actions/assert-no-docker-hub-pulls` step prints, in each Docker-backed job's log, every image the test run pulled and fails the job if any came from Docker Hub. The steady-state line is `Images pulled during the test run: none.`
- A failure of the reaper is now reported as a reaper failure, naming `TESTCONTAINERS_RYUK_DISABLED` and `RYUK_CONTAINER_IMAGE`, never as a Postgres-image pull failure. (The knob is `RYUK_CONTAINER_IMAGE`, not `TESTCONTAINERS_RYUK_CONTAINER_IMAGE`, in testcontainers-node.)

**A Testcontainers env knob only works if `turbo.json` passes it through.** turbo 2.x runs tasks in **strict** env mode: a task sees only the variables declared in `turbo.json` plus turbo's own defaults. `pnpm test` is `turbo run test`, so `QCMS_TEST_POSTGRES_IMAGE`, `TESTCONTAINERS_RYUK_DISABLED`, `TESTCONTAINERS_HOST_OVERRIDE` and the `DOCKER_*` overrides reach the _job_ and not the Vitest process unless they are listed in `globalPassThroughEnv`. That is how the #74 GHCR mirror was silently bypassed inside CI's `verify` job while the `api-e2e` and `portal-e2e` jobs (which invoke Vitest and Playwright directly, no turbo) used it correctly: the harness fell back to the default `postgres:16-alpine`, which was not the pre-pulled reference, and Docker went to Docker Hub for it. To prove a knob actually arrives, give it a value nothing can serve and watch the suite fail:

```sh
QCMS_TEST_POSTGRES_IMAGE=localhost:1/nope pnpm exec turbo run test --filter @qcms/db --force
```

If that **passes**, the variable is being stripped.

**What the container takes over from your machine** (ports 7000/7010, `node_modules` and the pnpm store, the Docker daemon), how to run the app inside it, and the full troubleshooting table are in [`DEV_CONTAINER.md`](DEV_CONTAINER.md). The rule that bites first: **only one qcms dev container runs at a time**, machine-wide.

**Rollback (the migration is reversible):** `.devcontainer/` touches no product code. Stop using it - or delete the directory - and the host workflow is unchanged: `pnpm install`, the merge gate, and `docker compose -f docker-compose.dev.yml up -d` behave exactly as they did before task 046 (re-run `pnpm install` on the host once if that checkout had been used in the container). Task 046 verified that the portal and API dev servers already bind `0.0.0.0` by default, so no source change was needed for host-browser viewing.

## The whole stack, and the developer toolbox

Tracing is **off unless you set an endpoint** (task 054, ADR-34), and no viewer ships with QCMS. What you reach for depends on how you are running the stack, and the two answers are genuinely different rather than variations of one. Section A is also the shortest route to a running QCMS you can sign in to, whether or not you care about traces.

### A. The composed stack: `pnpm dev:up`

The whole stack plus the toolbox, brought up and bootstrapped in one command. When it returns you can open the admin and **sign in**, with an account and password it printed:

```sh
# Once: copy the operator template and fill in every secret.
cp .env.compose.example .env

# Once: add a password for the read-only database role. It is NOT in
# .env.compose.example, because that file is the operator's and this is yours.
echo "QCMS_DB_VIEWER_PASSWORD=$(openssl rand -hex 24)" >> .env

pnpm dev:up
```

Underneath it is the opt-in developer-toolbox overlay (issue #417) layered on the solo topology, which is to say exactly this:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev-tools.yml up --detach --build --wait
```

The overlay carries Grafana's `otel-lgtm` (Grafana + Loki + Tempo + Prometheus + a collector, in one container) and `pgweb`. It is never part of the base invocation: ADR-20's shipped topology is four containers, and this is a toolbox rather than a deployment.

That gives you, at seat 0 (`docs/PORTS.md` for other seats, and all four are loopback-only):

| Where                   | What                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <http://localhost:7040> | The authoring admin. Sign in with the credential `dev:up` printed.                                                                                                                                                                                                                                                 |
| <http://localhost:7000> | The respondent portal.                                                                                                                                                                                                                                                                                             |
| <http://localhost:7050> | Grafana. Log in `admin` / `admin` - the image's own default, on a port only your machine can reach. The provisioned **QCMS Observability** home dashboard shows traffic, errors and correlated application logs; **Explore -> Loki** remains available for ad-hoc queries. Trace-correlated records link to Tempo. |
| <http://localhost:7060> | pgweb, connected read-only to the application database. No login screen: the connection comes from the environment.                                                                                                                                                                                                |

Bring it down with the matching command, which removes the containers, the network, the volumes and the overlay's containers (which are orphans of the base file and are otherwise left behind):

```sh
pnpm dev:down
```

### Sample data: `pnpm dev:seed`

A freshly created stack has an empty question library, which is the right default: the empty state is a screen worth reviewing, and it is what every list screen's empty-state copy is written against. When you want content instead, load the sample insurance library the kernel already ships as fixtures:

```sh
pnpm dev:seed
```

It is safe to re-run and reports what it skipped (`Seeded 0 question(s); 7 already present.`). A question that exists is left exactly as it is, because an id is permanent (R6) and a re-run must never look like an attempt to reuse one. The loader goes through the kernel rather than inserting rows, so what lands is what the compiler can render; it seeds **questions only**, not forms.

**Why this is a command rather than `DATABASE_URL=... pnpm qcms:seed-fixtures`.** That is the documented way to seed the `7S20` dev database, and it cannot reach this stack: the composed topology's Postgres is deliberately unpublished, and `scripts/compose-config.test.ts` asserts it stays that way with the toolbox overlay layered on. So the loader runs **inside** the network, as a one-shot container built from the API image (`docker/seed.Dockerfile`), which is the one image whose dependency tree already has `@qcms/core`, `@qcms/db`, drizzle and `pg`.

Two shapes were rejected and both for reasons that bite elsewhere in this repo. A **bind mount of the checkout** breaks the canonical dev-container seat: Compose drives the host daemon (ADR-29), so a repository path is resolved on the host's filesystem where it does not exist, and Docker silently creates an empty directory there. **Baking the loader into the API image** would put a sample-data writer and the fixture corpus into the deployed artifact; `apps/api/package.json` ships `files: ["dist"]`, and the seeding image is a separate Dockerfile so it stays that way.

The service is behind a Compose `seed` profile, so `dev:up` neither builds nor runs it, and `pnpm dev:seed` is the only thing that reaches it.

**What `dev:up` does beyond `docker compose up`**, because each piece is a step that used to be manual and easy to get wrong:

- **It creates the first administrator, inside this stack.** The composed stack has a Postgres of its own, separate from the `7S20` database `pnpm dev:portal` uses, so `create-admin` is run in this stack's `api` container (`scripts/compose-admin.mjs`, the same step the full-stack harness uses). An admin created against the wrong database is invisible here, and the symptom is a sign-in that fails with nothing wrong anywhere you would look.
- **It is safe to re-run.** `create-admin` refuses once any account exists (SEC-1) and that refusal is correct, so a second `dev:up` reports the skip and prints the URLs rather than working around it. To get a fresh account, `pnpm dev:down` first: the volume goes with it.
- **It pins `QCMS_ADMIN_AUTH_SECRET`** in `.env.dev-admin` (gitignored), generating one on first use. Unpinned, the API mints a fresh secret every boot, which makes an existing TOTP enrolment permanently unverifiable and burns a recovery code per restart - see the pinning note earlier in this guide. An exported value wins; `.env` is deliberately not consulted, so re-copying the operator template cannot silently replace a pinned secret with its placeholder. The file is made **owner-only on every run**, not just when it is created: if you already have one that other users on the machine can read, `dev:up` tightens it and prints one line saying so. (`writeFileSync`'s `mode` option applies only when the call creates the file, so setting it at creation would have protected the one case that needs it least.)
- **It derives the seat's ports and Compose project name** from `scripts/ports.mjs` (R8). Seat 0's project is `qcms-local-stack`, so `docker compose ls` shows one named group; another seat gets `qcms-local-stack-s<N>`, its own containers and its own volume. Neither collides with the dev database (`qcms-dev`) or the full-stack e2e stack. From a linked worktree, `QCMS_PORT_SEAT` is refused rather than defaulted (issue #296): `dev:down` removes volumes, so an adopted seat would delete another lane's stack rather than read it.
- **It pins the publish to loopback**, whatever `QCMS_BIND_ADDRESS` says in `.env`. That variable is legitimately `0.0.0.0` for an operator with a separate ingress host, but this stack prints a plaintext credential and runs a Grafana logged in with `admin`/`admin`.
- **Inside the dev container** these ports are published on the **host's** loopback (Compose drives the host daemon, ADR-29), so open them in a browser on the host. They are not reachable from the container's own `localhost`.

Four things worth knowing before you go looking for something that is missing:

- **First sign-in forces TOTP enrolment** (SEC-1) and shows the recovery codes exactly once. Have an authenticator app open before you start. `QCMS_ADMIN_2FA=optional` relaxes it while developing, and both the API and the admin read it, so setting it in one place only makes every admin API call 401.
- **The home dashboard is repository-provisioned.** Its **Service** selector filters `qcms-admin`, `qcms-portal` and `qcms-api`; paste an `x-request-id` into **Request ID** to isolate one BFF-to-API call. Expand a row and follow `trace_id` to Tempo. The dashboard definition is copied into a thin local LGTM wrapper image rather than bind-mounted, so it works when a dev container drives the host Docker daemon (ADR-29). It is read-only in Grafana: edit `docker/grafana/qcms-observability.json` and rebuild instead of making a change that disappears with the container.
- **Logs are intentionally concise.** Exported records contain only approved operational fields such as route template, method, status, duration, request id and opaque error id. They never contain request bodies, answers, direct identifiers, headers, cookies, query strings, exception messages or stacks (SEC-13). Use the trace link or copy `requestId` to follow one request across services.
- **The first request after a cold start may not appear.** `lgtm` takes tens of seconds to come up and ships no healthcheck, so the apps start before the collector is listening and the earliest spans exhaust their retry budget. Make a second request.
- **Nothing persists.** The overlay declares no volumes, so a restart of `lgtm` empties the dashboard. That is the trade that makes `down` leave nothing behind.

**The database viewer is the only credentialed database client in the repo**, and it is scoped accordingly. It does not use `QCMS_DB_PASSWORD`: the overlay creates a `qcms_ro` role granted PostgreSQL's predefined `pg_read_all_data` (reads on every table, including ones a future migration adds) and nothing else, with `default_transaction_read_only` set on the role, and runs pgweb with `--readonly` on top. A write is refused by the database, not by the client. After task 056 the API is otherwise the only process in the stack holding a database credential (ADR-35), which is why this one is worth the paragraph.

### B. Dev servers outside Compose: a hand-run viewer

`pnpm dev:portal` and `pnpm dev:admin` run on your machine, not in the Compose network, so they cannot reach the overlay's collector (its OTLP ingest is deliberately unpublished) and cannot share a seat with the composed stack anyway. For those, run a standalone dashboard yourself. Two that need no configuration:

```sh
# Jaeger all-in-one (trace search + timeline; its UI is on 16686)
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest

# .NET Aspire dashboard (traces, logs and metrics in one pane; its UI is on 18888)
docker run --rm -p 18888:18888 -p 4318:18889 \
  -e DASHBOARD__FRONTEND__AUTHMODE=Unsecured \
  mcr.microsoft.com/dotnet/aspire-dashboard:latest
```

Then start a dev server with the standard variables set (all three processes use the same knobs):

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=qcms-portal \
NEXT_OTEL_VERBOSE=1 \
pnpm dev:portal
```

Those two containers are yours to start and stop; nothing in the repo wires them in, and `4318` in the recipes is the OTLP/HTTP default rather than a QCMS allocation (`docs/PORTS.md` explains why third-party tools you run yourself stay outside it).

### Notes that apply to both

- **`OTEL_EXPORTER_OTLP_ENDPOINT` is the whole switch.** Unset, no app starts an SDK at all (not "starts one that fails to export") - so an empty dashboard with the variable unset is correct behaviour. Compose forwards the variable to Admin, Portal and API, defaulting to empty in the shipped topology and to `http://lgtm:4318` in the developer overlay.
- **Set `OTEL_SERVICE_NAME` per process** only when overriding it. The defaults are `qcms-admin`, `qcms-portal` and `qcms-api`; the overlay leaves it unset so those names remain distinct.
- **`NEXT_OTEL_VERBOSE=1`** makes Next emit its fuller span set rather than the default subset. Useful when you are debugging the portal's own render/fetch phases; noisy otherwise.
- **The expected root span is `GET /requested/pathname`** on the portal, with the BFF's `fetch POST .../sessions/...` beneath it, then the API's `POST /sessions/:id/...` server span (that is the `traceparent` hop working), then `pg.query:*` spans under that.
- **The secure-link route shows as `GET /l/[token]`.** That is SEC-13 redaction doing its job: the token is a credential and is removed from span names and URLs before export. Same reason you will not find answer values or `db.statement` parameters anywhere in a span.
- **Admin and respondent traffic use the same propagation model.** Each BFF forwards `traceparent` and `x-request-id` to the API. The API exports only the semantic `@hono/otel` SERVER span; raw incoming HTTP spans are suppressed so a request does not appear twice.
- **Background work is its own trace, correctly.** The API's outbox delivery pass runs on a timer with no inbound request above it, so its `pg.query:*` spans are roots of single-span traces rather than orphans. Request-driven queries do sit under their request span.
- The Playwright suite's own in-test receiver lives inside the QCMS allocation (`17S30`, so 17030 at seat 0), well away from all of the above, so a running dashboard and a test run cannot collide. See [`docs/PORTS.md`](PORTS.md).

## The browser suite's gates, and measuring them

Every portal Playwright spec imports `test` from `apps/portal/e2e/support/gates.ts` rather than from `@playwright/test`, so two gates run automatically: a **browser-fault gate** (any `console.error`, any `console.warn`, any uncaught `pageerror`) and a **server-log gate** (any error-level line the API, Postgres or the portal dev server wrote during the test). That file is the authority on what each one fails on, and on why every allowlist entry is there.

**To find out what the console actually said, do not patch the gate.** Reviewing a change to `gates.ts` needs the real message population broken down by level, and hand-adding a temporary recorder to that file means editing the file under review in order to review it, then reverting and re-verifying the tree - which cost two people a full suite run each on issue #147. Use the census helper instead:

```ts
import { censusConsole } from "./support/console-census.js";

const census = censusConsole(page); // BEFORE the first navigation

await startAnonymousFlow(page, slug);

census.report(); // levels and counts, most frequent first
census.of("warning"); // the text of every warn message
census.byLevel().get("error") ?? 0; // one level's count
```

It attaches its own listener and touches no gate state, so it cannot change a verdict: Playwright fans a console event out to every listener. The level is Playwright's own typed union rather than a prefix parsed out of the text - note that Playwright spells `console.warn` as `"warning"`, the DevTools protocol name, which is precisely the distinction a census exists to get right. `apps/portal/e2e/a11y-error-summary.pw.ts` carries a worked example, including the cross-check that asks the gate's exported `browserConsoleFault` which of the observed messages would have failed the run.

**Hydration, when a spec needs the React render rather than the first paint.** The portal server-renders a real, fillable no-JS form which React then replaces wholesale, so "the page" names two different DOMs. `waitForHydration` (`apps/portal/e2e/support/hydration.ts`) waits for `data-qcms-hydrated`, which the page stamps on `<html>` from a mount effect and which is therefore absent from every server render. Entry helpers already call it; a spec that navigates itself calls it directly, on any portal page. To measure or audit the **fallback** on purpose instead, `starveScripts` (`apps/portal/e2e/support/script-starve.ts`) answers the app bundle with an empty 200 while leaving the page scriptable, which is what `test.use({ javaScriptEnabled: false })` cannot do.

## Running work

| You type             | What happens                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `/task 002`          | Claims one numbered task, delegates implementation, opens the PR, delegates exact-head review, and squash-merges the approved green head. |
| `/next-task`         | Selects the next executable numbered task using the ledger and its ordering table.                                                        |
| `/next-issue`        | Selects one actionable issue and uses the same executor, reviewer, and merge flow on `fix/NN-slug`.                                       |
| `/next-work`         | Handles review findings and interrupted work first, then selects an eligible task or issue.                                               |
| `/loop /next-work`   | Repeats single-seat work selection until nothing is executable or a real human or repository-wide blocker remains.                        |
| `/loop /next-work 3` | Allows up to three pairwise-independent executors while keeping review and merge serialized.                                              |

Every task and issue PR requires an independent reviewer subagent. Its PR comment ends with `AGENT-REVIEW: APPROVE @<headRefOid>` or `AGENT-REVIEW: CHANGES-REQUESTED @<headRefOid>`. A push makes the verdict stale. The root conductor addresses findings, checks all comment surfaces and required CI, and performs serialized squash merges.

**Never run two interactive sessions in one checkout.** If you want a second hands-on session, give it its own `git worktree add ../qcms-me main`.

## Human gates

Only gates explicitly named by an authoritative task or decision apply. The agent prepares the requested material and parks the branch with `HANDOFF: AWAITING-HUMAN` until the Code Owner responds. Unrelated work may continue when its dependencies and file footprint are independent.

## Surviving usage limits (true unattended runs)

An in-session `/loop` dies when your Claude usage window closes and **won't self-restart** - nothing inside a session can wake itself hours later. For runs that should outlast limit windows, use the supervisor instead:

```sh
# Run it inside the dev container, which is the safety boundary.
bash scripts/agent-loop.sh                 # one conductor, one executor at a time
bash scripts/agent-loop.sh --parallel 3    # up to 3 independent executors
bash scripts/agent-loop.sh --help
```

This is the only supervisor. It launches `/next-work` in a fresh headless root session for every iteration. Durable state lives in claims, branches, PR comments, `HANDOFF.md`, and the ledger. `NEXT-WORK: LANDED` and `RESUMED` continue; `AWAITING-HUMAN`, `BLOCKED`, and `NOTHING` stop. A session crash without a sentinel waits for the retry interval and then recovers from repository state. Progress is written to `agent-loop.log`.

Each iteration owns a process group. When the root session exits or the supervisor is interrupted, every process that session spawned is terminated before another iteration starts: SIGTERM first, then SIGKILL for anything still there after a five-second grace. **A second Ctrl+C during that grace escalates** - it skips the rest of the wait, SIGKILLs the group immediately, and logs that it did (issue #258). That is what an insistent interrupt means to an operator, and before it existed a descendant that ignores SIGTERM outlived the supervisor while the log said everything had been stopped.

## Editing skills/agents while a loop is running

After changing `.claude/skills/` or `.claude/agents/`, restart running sessions. `scripts/agent-loop.sh` starts a fresh root session for each iteration and picks up the current files automatically.

## Monitoring and control

- **State:** `docs/features/README.md` (the ledger) is always current; `git log --oneline` shows what landed; `git worktree list` shows live executors.
- **Interrupt safely:** Esc stops the current session; in-flight executor branches survive, and because the pushed branch is the claim, the claim survives with them. A stopped task ends as a live `origin/feat/NNN-*` branch (ideally with a committed `HANDOFF.md`) or as a `blocked (issue #)` ledger row - `/next-task` prefers resuming a handoff over starting fresh.
- **What is waiting on you:** `git ls-remote --heads origin 'feat/*'` lists live claims; for each, the branch tip's `HANDOFF.md` first line says which kind of park it is. `HANDOFF: AWAITING-HUMAN <what>` is one the loop deliberately stepped over and will not resume until you act - those are your queue, and the loop will keep working around them (up to three) rather than stopping. `INTERRUPTED` and `BLOCKED` are ones it will pick back up itself.
- **Stale claim cleanup** (a session died mid-task): check the branch for a `HANDOFF.md`; either resume via `/task NNN`, or, if there is nothing worth keeping, **delete the remote branch** - that releases the claim, with no ledger edit needed (and none possible: `main` cannot be pushed directly). Then `git worktree remove` any leftover under `.claude/worktrees/`.

## Permissions tuning

- The allowlist lives in `.claude/settings.json` as `Bash(...)` families. The loop uses `bypassPermissions` inside the dev container, so the allowlist applies only to interactive sessions.
- Getting prompted for something routine? Run `/fewer-permission-prompts` - it scans real transcripts and proposes evidence-based allowlist additions.
- Keep `npm`, `npx`, `yarn`, and `git push --force` denied. Use `pnpm exec` or `pnpm dlx`.

## Conventions the agents follow (so you can spot violations)

One task per PR/branch (`feat/NNN-slug`) · Conventional Commits with the task number · **no AI attribution trailers in commit messages** · green-or-clean, where green means **`pnpm verify`** (one command, a superset of CI's unit job; `pnpm verify:browser` adds the Playwright suite for portal/admin/`@qcms/ui` work) · never merge red · discoveries become issues (`phase-4` for cut-line itches), never scope creep · docs named in a task update in the same change.
