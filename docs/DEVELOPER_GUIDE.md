# QCMS - Developer Guide

> **Methodology vs. runbook:** this is the *operator's runbook* - how to drive the build day-to-day. For the *why* (principles, task-design rules, the session protocol, the audit checklist) see [`AGENTIC_DEVELOPMENT.md`](AGENTIC_DEVELOPMENT.md).

How to drive the QCMS multi-agent development flow as the human in the loop. (What the *agents* must do lives in `CLAUDE.md` + `PROJECT_INSTRUCTIONS.md`; this file is for you.)

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

**Trust the workspace once for interactive sessions.** A fresh container prints `Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted`. Under `bypassPermissions` this is harmless (nothing is being gated), but an *interactive* session in the container will keep asking until you accept the trust dialog once, or set `projects["/workspaces/<folder>"].hasTrustDialogAccepted: true` in `~/.claude/.claude.json`.

**Ports: the allocation lives in [`docs/PORTS.md`](PORTS.md).** That is the only table, and it is binding (R8, ADR-37): `7Sxx` for stable human-facing services, `17Sxx` for ephemeral test harnesses, seat `S` from `QCMS_PORT_SEAT` and defaulting to 0. The numbers below are seat 0, which is the default and what every existing setup already runs. Nothing here restates the table; go there to add or move anything.

**Viewing the app from your host browser:** the dev servers listen on all interfaces inside the container (`next dev` and the Hono `serve()` both bind `0.0.0.0` by default, verified by the listen socket). The ports the container serves, **7000, 7010, 7030 and 7040**, leave it via `appPort` (published on the Docker host by **any** launcher, including a bare CLI `devcontainer up`) plus `forwardPorts` (the VS Code / Codespaces editor tunnel). `http://localhost:7000` on the host reaches the portal on either route: measured `200` from the host against a CLI-launched container running `pnpm exec next dev --port 7000`.

**Artifacts over HTTP (7030 at seat 0):** `pnpm artifacts` starts a read-only, dependency-free static server (`scripts/serve-artifacts.mjs`) so gate evidence and design previews render in the host browser instead of being fished out of the container by path. `http://localhost:7030/` indexes three roots: `/gates/` (landed evidence in `docs/gates/`), `/plan/` (design previews and planning artifacts), and `/worktrees/<name>/` (an in-flight task branch's `docs/gates/`, the usual place to review a screenshot set before its PR merges). The port leaves the container the same way as 7000/7010 (`appPort` + `forwardPorts`); a container created before 7030 was added to `appPort` publishes it only after a rebuild.

**7020 belongs to the host.** The dev Postgres from `docker-compose.dev.yml` publishes 7020 on the host, so the container must *not* claim it - if it did, whichever of the two started second would fail to bind. The container reaches it over the host gateway instead:

```sh
docker compose -f docker-compose.dev.yml up -d
pnpm dev:portal   # finds the dev DB itself; see CONTRIBUTING for why not host.docker.internal
```

**`QCMS_DOCKER_PUBLISH_HOST` overrides that detection**, and it is the one escape hatch on this path. `scripts/docker-host.mjs` answers "which host is a Docker-published port on, as seen from *this* process": `localhost` on a plain host checkout and on CI, and the container's default-route gateway inside the dev container, because publishing binds on the Docker host and inside the container that host is another machine. Set the variable and that answer is taken as given, before anything is probed:

```sh
QCMS_DOCKER_PUBLISH_HOST=172.17.0.1 pnpm dev:portal
```

Reach for it when the detection is wrong for your setup - an unusual routing table, a rootless or remote daemon, a gateway that is not the host. It is worth knowing about because of what it reaches: the same value picks the **database host** `pnpm dev:portal` and `pnpm dev:admin` dial (one script, `scripts/dev-stack.mjs`), so a wrong value there looks like a dev server that cannot find Postgres rather than like a misread route. The full-stack Compose harness does **not** use it (it joins the Compose network and forwards this container's loopback instead, `docs/PORTS.md`), so setting it changes nothing about `pnpm up:e2e`.

**Running the admin app: `pnpm dev:admin`.** It is `pnpm dev:portal`'s twin (same script,
`scripts/dev-stack.mjs`): dev database up and migrated, kitchen-sink form seeded, API
started, then the admin on seat 0's **7040**. Both children get the *same* freshly
generated SEC-4 internal token, which is why the admin cannot simply be pointed at an API
someone else started: that token exists only in the launching process's memory and is
written nowhere (issue #281). The cost is that `dev:admin` and `dev:portal` each start an
API on 7010 and so cannot share a seat: give the second one `QCMS_PORT_SEAT=1`.

One extra step the portal does not need: the admin has no self-registration path (SEC-1),
so the deployment's first account comes from a command. Since task 056 the admin itself
holds no database handle - better-auth lives in the API - so that bootstrap command is an
**API-side** one and takes the API's env, not the admin's.

```sh
# Pin the auth secret for the whole shell session, BEFORE `pnpm dev:admin` starts the
# API - an unpinned restart destroys an existing TOTP enrolment, see below. Any value
# >= 32 chars with no whitespace or commas. `pnpm dev:admin` warns when it is unset.
export QCMS_ADMIN_AUTH_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")

pnpm dev:admin        # dev DB + API + admin on http://localhost:7040

# In a second terminal, once only, if this database has no admin yet. The launcher
# prints this command with the values already filled in.
DATABASE_URL=postgres://qcms:qcms@127.0.0.1:7020/qcms \
  QCMS_ADMIN_BASE_URL=http://localhost:7040 \
  QCMS_ADMIN_AUTH_SECRET=$QCMS_ADMIN_AUTH_SECRET \
  QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD='a long passphrase' \
  pnpm qcms:create-admin
```

7040 leaves the dev container the same way 7000/7010/7030 do (`appPort` + `forwardPorts`),
and it was added to that list later than the rest: a container created before then
publishes it only after `pnpm devcontainer rebuild`.

`QCMS_ADMIN_AUTH_SECRET` is required here because `loadConfig` validates it, but for
*this command* it does **not** have to match the running API's: `create-admin` creates an
account (salted password hash, secret-independent) and enrols no second factor, and it
revokes the one session it mints, so nothing it writes is ever decrypted by another
process.

**Pin `QCMS_ADMIN_AUTH_SECRET` in your environment before you enrol, though.** It is the
key better-auth encrypts the stored TOTP secret under, so changing it does not just
invalidate cookies - it makes an existing enrolment permanently unverifiable. Checked
against better-auth 1.6.25's own source rather than inferred: `two-factor/enable` stores
the secret with `symmetricEncrypt({ key: ctx.context.secretConfig, ... })`
(`dist/plugins/two-factor/index.mjs:105`) and every verification decrypts with the
*current* key (`dist/plugins/two-factor/totp/index.mjs:188`, and `:122` for the URI
reveal). `pnpm dev:portal` and `pnpm dev:admin` generate a fresh secret when the variable
is unset, so an unpinned restart leaves your authenticator's codes rejected for good.
`pnpm dev:admin` says so on startup rather than leaving you to remember it.

What is left in that state is the recovery codes, and only those. They survive because
they are stored as plain JSON unless `storeBackupCodes: "encrypted"` is configured, which
QCMS does not (`dist/plugins/two-factor/backup-codes/index.mjs:45`) - but there are
**ten** of them (`:15`, `amount ?? 10`), the admin ships no re-enrolment screen, and every
unpinned restart costs one. After ten, that account is unusable and the fastest way out is
a fresh database. Setting `QCMS_ADMIN_2FA=optional` afterwards does not rescue it: the
challenge is demanded whenever the account's `twoFactorEnabled` is true.

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

**A Testcontainers env knob only works if `turbo.json` passes it through.** turbo 2.x runs tasks in **strict** env mode: a task sees only the variables declared in `turbo.json` plus turbo's own defaults. `pnpm test` is `turbo run test`, so `QCMS_TEST_POSTGRES_IMAGE`, `TESTCONTAINERS_RYUK_DISABLED`, `TESTCONTAINERS_HOST_OVERRIDE` and the `DOCKER_*` overrides reach the *job* and not the Vitest process unless they are listed in `globalPassThroughEnv`. That is how the #74 GHCR mirror was silently bypassed inside CI's `verify` job while the `api-e2e` and `portal-e2e` jobs (which invoke Vitest and Playwright directly, no turbo) used it correctly: the harness fell back to the default `postgres:16-alpine`, which was not the pre-pulled reference, and Docker went to Docker Hub for it. To prove a knob actually arrives, give it a value nothing can serve and watch the suite fail:

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

| Where | What |
|---|---|
| <http://localhost:7040> | The authoring admin. Sign in with the credential `dev:up` printed. |
| <http://localhost:7000> | The respondent portal. |
| <http://localhost:7050> | Grafana. Log in `admin` / `admin` - the image's own default, on a port only your machine can reach. **Explore -> Tempo -> Search** lists recent traces. |
| <http://localhost:7060> | pgweb, connected read-only to the application database. No login screen: the connection comes from the environment. |

Bring it down with the matching command, which removes the containers, the network, the volumes and the overlay's containers (which are orphans of the base file and are otherwise left behind):

```sh
pnpm dev:down
```

**What `dev:up` does beyond `docker compose up`**, because each piece is a step that used to be manual and easy to get wrong:

- **It creates the first administrator, inside this stack.** The composed stack has a Postgres of its own, separate from the `7S20` database `pnpm dev:portal` uses, so `create-admin` is run in this stack's `api` container (`scripts/compose-admin.mjs`, the same step the full-stack harness uses). An admin created against the wrong database is invisible here, and the symptom is a sign-in that fails with nothing wrong anywhere you would look.
- **It is safe to re-run.** `create-admin` refuses once any account exists (SEC-1) and that refusal is correct, so a second `dev:up` reports the skip and prints the URLs rather than working around it. To get a fresh account, `pnpm dev:down` first: the volume goes with it.
- **It pins `QCMS_ADMIN_AUTH_SECRET`** in `.env.dev-admin` (gitignored), generating one on first use. Unpinned, the API mints a fresh secret every boot, which makes an existing TOTP enrolment permanently unverifiable and burns a recovery code per restart - see the pinning note earlier in this guide. An exported value wins; `.env` is deliberately not consulted, so re-copying the operator template cannot silently replace a pinned secret with its placeholder. The file is made **owner-only on every run**, not just when it is created: if you already have one that other users on the machine can read, `dev:up` tightens it and prints one line saying so. (`writeFileSync`'s `mode` option applies only when the call creates the file, so setting it at creation would have protected the one case that needs it least.)
- **It derives the seat's ports and Compose project name** from `scripts/ports.mjs` (R8). Seat 0's project is `qcms-local-stack`, so `docker compose ls` shows one named group; another seat gets `qcms-local-stack-s<N>`, its own containers and its own volume. Neither collides with the dev database (`qcms-dev`) or the full-stack e2e stack. From a linked worktree, `QCMS_PORT_SEAT` is refused rather than defaulted (issue #296): `dev:down` removes volumes, so an adopted seat would delete another lane's stack rather than read it.
- **It pins the publish to loopback**, whatever `QCMS_BIND_ADDRESS` says in `.env`. That variable is legitimately `0.0.0.0` for an operator with a separate ingress host, but this stack prints a plaintext credential and runs a Grafana logged in with `admin`/`admin`.
- **Inside the dev container** these ports are published on the **host's** loopback (Compose drives the host daemon, ADR-29), so open them in a browser on the host. They are not reachable from the container's own `localhost`.

Four things worth knowing before you go looking for something that is missing:

- **First sign-in forces TOTP enrolment** (SEC-1) and shows the recovery codes exactly once. Have an authenticator app open before you start. `QCMS_ADMIN_2FA=optional` relaxes it while developing, and both the API and the admin read it, so setting it in one place only makes every admin API call 401.
- **The logs pane is empty, and that is expected.** QCMS exports traces only. OTLP log export is issue #370, which carries a SEC-13 amendment and is deliberately a separate change. Loki is running; nothing sends to it.
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

Then start the dev servers with the standard variables set (the same two knobs both processes read):

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=qcms-portal \
NEXT_OTEL_VERBOSE=1 \
pnpm dev:portal
```

Those two containers are yours to start and stop; nothing in the repo wires them in, and `4318` in the recipes is the OTLP/HTTP default rather than a QCMS allocation (`docs/PORTS.md` explains why third-party tools you run yourself stay outside it).

### Notes that apply to both

- **`OTEL_EXPORTER_OTLP_ENDPOINT` is the whole switch.** Unset, neither app starts an SDK at all (not "starts one that fails to export") - so an empty dashboard with the variable unset is correct behaviour, not a bug. Note that **Compose forwards only what a service names in `environment:`**: before issue #417 neither app named this variable, so setting it in `.env` did nothing to a composed stack. It now reaches both, defaulting to empty.
- **Set `OTEL_SERVICE_NAME` per process** if you start the API separately, otherwise both default names collide in the dashboard's service list (`qcms-api` and `qcms-portal` are the defaults when you do nothing). The overlay leaves it unset for exactly this reason.
- **`NEXT_OTEL_VERBOSE=1`** makes Next emit its fuller span set rather than the default subset. Useful when you are debugging the portal's own render/fetch phases; noisy otherwise.
- **The expected root span is `GET /requested/pathname`** on the portal, with the BFF's `fetch POST .../sessions/...` beneath it, then the API's `POST /sessions/:id/...` server span (that is the `traceparent` hop working), then `pg.query:*` spans under that.
- **The secure-link route shows as `GET /l/[token]`.** That is SEC-13 redaction doing its job: the token is a credential and is removed from span names and URLs before export. Same reason you will not find answer values or `db.statement` parameters anywhere in a span.
- **The admin app has no instrumentation at all** (issue #185), so authoring traffic produces API-rooted traces with no admin span above them - worth knowing before you open the dashboard expecting to debug the authoring flow. Issue #184 (a second SERVER span on the API's inbound path) is tracked in the same area; if you see a duplicate, it is that and not something you have misconfigured.
- **Background work is its own trace, correctly.** The API's outbox delivery pass runs on a timer with no inbound request above it, so its `pg.query:*` spans are roots of single-span traces rather than orphans. Request-driven queries do sit under their request span.
- The Playwright suite's own in-test receiver lives inside the QCMS allocation (`17S30`, so 17030 at seat 0), well away from all of the above, so a running dashboard and a test run cannot collide. See [`docs/PORTS.md`](PORTS.md).

## Running work

| You type | What happens |
|---|---|
| `/task 002` | One plan task, full relay: **claim** (push `feat/002-slug` to origin - the live branch *is* the lock) → **task-executor** implements in an isolated worktree on that branch → *(UI tasks: pauses at the screenshot gate for your sign-off, evidence committed under `docs/gates/002/`)* → **task-reviewer** verifies every exit criterion + rule against the diff → rebase onto current main, re-run gates, flip the ledger row to `done (PR #N)` as a commit **on the branch**, open the PR, wait for green checks **and for a `PO-REVIEW: APPROVE @<headRefOid>` sentinel bound to that head**, then `gh pr merge --squash`. |
| `/next-task` | Picks the next executable `todo` (numeric order, honoring the ordering-exception table in `docs/features/README.md`) and runs the `/task` flow. |
| `/loop /next-task` | Autonomous run, task after task. **A gate parks that task, not the run:** the task keeps its branch claim plus a `HANDOFF: AWAITING-HUMAN` record, its worktree is torn down, and the loop moves to the next pairwise-independent task in a fresh worktree - or to an eligible GitHub issue if no task qualifies. It stops only when everything remaining is a gate, a `blocked` row, or a parked claim (and never holds more than 3 parked at once). |
| `/loop /next-task 3` | Same, up to 3 **pairwise-independent** tasks per batch (parallel executors, serialized merges). |
| `/next-issue` | Picks the next actionable GitHub issue by label tier (`security` > `bug` > unlabeled > `enhancement`; the routing labels `needs-decision`/`blocked-upstream`/`workshop`/`admin-stage` and `phase-4` are excluded) and runs the same executor+reviewer relay on `fix/NN-slug` - then **opens one PR per issue** (body: acceptance checklist, `Fixes #NN`, reviewer verdict, retro lines; respondent-visible changes carry gate screenshots under `docs/gates/pr-NN/`). The conductor never merges. |
| `/next-issue 3` / `/loop /next-issue 3` | Up to 3 **pairwise-independent** issues per batch (disjoint packages/seams; when in doubt, not batched) - own claim, executor worktree, reviewer, and PR each, no cross-batch barrier. Safe because conductors never merge; the PO loop serializes landings. |
| `/loop /next-issue` | Issue after issue until nothing is executable or a stated repo-wide blocker. Human gates park **the PR**, never the run; an open PR whose newest `PO-REVIEW: CHANGES-REQUESTED @<headRefOid>` sentinel (the full head SHA) matches the current head is picked up as a findings cycle before fresh work. |

**Task PRs need a review sentinel before they merge.** `/task` opens the PR and then polls it for ~30 minutes for a `PO-REVIEW:` sentinel bound to the current head: `APPROVE @<headRefOid>` authorizes the squash-merge, `CHANGES-REQUESTED @<headRefOid>` becomes the work order, and no sentinel at all ends the iteration as `NEXT-TASK: AWAITING-HUMAN po-review <NNN>`. Since `scripts/agent-loop.sh` stops on `AWAITING-HUMAN`, **an unattended `/loop /next-task` run only chains past one task if the PO seat's review loop is running too** (or you post the sentinel yourself as a PR comment). That is the intended coupling, not a bug - but it is the reason a supervisor run can look like it "stopped for no reason" after a single landing.

Issue PRs are reviewed and squash-merged by the **PO seat's review loop** (procedure: `plan/pr-review-loop.md`): stranger review, a Copilot-comment sweep where every comment gets a fix or a reasoned reply, verdicts ending in a head-bound `PO-REVIEW:` sentinel, merge when every check concludes SUCCESS except at most the node-26 `verify` leg, which is `continue-on-error` by design and may be waived with the waiver recorded in the verdict, then the retro append. You can also review and merge yourself - the sentinel comment is the only protocol.

**Never run two interactive sessions in one checkout.** If you want a second hands-on session, give it its own `git worktree add ../qcms-me main`.

## Your gates (the agent parks the task and works around you)

Since 2026-08-01 a gate no longer halts the run: the agent commits the evidence, parks the task with a `HANDOFF: AWAITING-HUMAN` record on its branch, and moves to independent work. Your sign-off is still what unparks it, and nothing proceeds on *that* task without you - you are just no longer the bottleneck for everything else.

- **Wireframe sign-off (042):** review `docs/wireframes/*.md`, then flip each file's status line to `Signed off: <you>, <date>`.
- **Screenshot gate (every UI task):** the agent presents static-render screenshots (screen × state × theme); reply with approval or corrections - wiring starts only after your OK.
- **Manual a11y pass (030):** you (or a tester) run NVDA/VoiceOver from the prepared script; results are logged to `docs/a11y-pass-<date>.md`.
- **Security review sign-off (040)** and the **external-tester launch gate (038)**: prepared by agents, executed by humans.

## Surviving usage limits (true unattended runs)

An in-session `/loop` dies when your Claude usage window closes and **won't self-restart** - nothing inside a session can wake itself hours later. For runs that should outlast limit windows, use the supervisor instead:

```sh
# Run it inside the dev container (ADR-29) - that is what makes bypassPermissions safe.
bash scripts/agent-loop.sh                                       # task lane, one task at a time
bash scripts/agent-loop.sh --parallel 3                          # up to 3 independent tasks per batch
bash scripts/agent-loop.sh --prompt /next-issue --mailbox dev2   # a second, issue-lane supervisor
bash scripts/agent-loop.sh --help                                # all options
```

This is the only supervisor. `agent-loop.ps1` was **retired** (ADR-29 amended 2026-07-25): a Windows contributor's supported path is the container itself, via Docker Desktop or Codespaces. Outside the container the interactive fallback is `/loop /next-task`, which does not survive a usage-limit window.

**The supervisor drives either lane** (since #239). `-P/--prompt` chooses what each iteration runs (default `/next-task`; pass `/next-issue` for the issue lane), and the sentinel matching is `NEXT-(TASK|ISSUE):`, so the issue loop is supervised exactly like the task loop and survives a usage-limit window the same way. `-M/--mailbox NAME` gives a lane its own seat-mail identity (`../seat-mail/<name>/`, plain folder name only) and its own log file (`agent-loop-<name>.log`); any mailbox other than the default `dev` also appends the second-lane discipline note to every iteration's prompt. `--parallel` is `/next-task`-only: on any other prompt the count is not appended, because only the task lane batches. So a second, issue-lane agent alongside the task loop is `--prompt /next-issue --mailbox dev2`.

The script runs that prompt in a **fresh headless session per iteration** (safe because the repo is the memory: claims, branches, HANDOFFs), reads the `NEXT-TASK:`/`NEXT-ISSUE:` sentinel each session emits, and: continues immediately on `LANDED`/`RESUMED`/`PR #`, stops on `AWAITING-HUMAN`/`BLOCKED`/`NOTHING`, and on *no sentinel* (usage limit or crash) waits the retry interval (`--retry-minutes`, default 30) and retries - the next session's stale-claim recovery picks up whatever the killed one left mid-flight. Progress is in `agent-loop.log` (or `agent-loop-<mailbox>.log` for a named lane) and, as always, the ledger.

**Each iteration owns a process group, and nothing outlives it** (issue #240). A session spawns background work of its own, and before this the supervisor waited on the session process only: whatever ended a session left its descendants reparented to init and still running. An orphan from a dead iteration that kept draining `../seat-mail/<mailbox>/` could eat a steer meant for the live one, and the bus is at-most-once per file, so the message was simply gone. Now the session is launched into its own process group and the whole group is terminated once the session's own process exits, on every path out of an iteration - including Ctrl+C, which takes the running session and everything it spawned down with the supervisor. A signal arriving in the launch window - after the session has been forked but before the supervisor knows the group id - is held and replayed the moment that id is known, so there is no instant at which an interrupt reaps nothing.

## Editing skills/agents while a loop is running

A long-lived session follows the instructions it already read - edits to `.claude/skills/` or `.claude/agents/` land on disk but a running conductor may keep executing the old flow from memory. After changing any skill or agent file: **restart running sessions**, or (better) run via `scripts/agent-loop.sh`, whose fresh-session-per-task model picks up the current files on every iteration by construction.

## Monitoring and control

- **State:** `docs/features/README.md` (the ledger) is always current; `git log --oneline` shows what landed; `git worktree list` shows live executors.
- **Seat mail (a machine-local bus between the two seats, never committed):** `../seat-mail/dev/` is the dev loop's inbox, `../seat-mail/pm/` the PO seat's - both sibling folders of the checkout. Drop a plain-text `message_<UTC timestamp>.txt` in either to steer the other seat's next iteration ("PR #NNN is waiting on review", "skip X today"); each loop reads its inbox at the top of a run, acts, then moves the file to the sibling `read/` folder as the ack. `scripts/agent-loop.sh` injects its own lane's inbox (`--mailbox`, default `dev`) into every headless iteration. Mail carries routing and coordination only, never scope. Neither folder existing is fine - both seats skip silently.
- **Interrupt safely:** Esc stops the current session; in-flight executor branches survive, and because the pushed branch is the claim, the claim survives with them. A stopped task ends as a live `origin/feat/NNN-*` branch (ideally with a committed `HANDOFF.md`) or as a `blocked (issue #)` ledger row - `/next-task` prefers resuming a handoff over starting fresh.
- **What is waiting on you:** `git ls-remote --heads origin 'feat/*'` lists live claims; for each, the branch tip's `HANDOFF.md` first line says which kind of park it is. `HANDOFF: AWAITING-HUMAN <what>` is one the loop deliberately stepped over and will not resume until you act - those are your queue, and the loop will keep working around them (up to three) rather than stopping. `INTERRUPTED` and `BLOCKED` are ones it will pick back up itself.
- **Stale claim cleanup** (a session died mid-task): check the branch for a `HANDOFF.md`; either resume via `/task NNN`, or, if there is nothing worth keeping, **delete the remote branch** - that releases the claim, with no ledger edit needed (and none possible: `main` cannot be pushed directly). Then `git worktree remove` any leftover under `.claude/worktrees/`.

## Permissions tuning

- Allowlist lives in `.claude/settings.json`, as `Bash(...)` families (rules are per-tool). Inside the dev container the loop runs in `bypassPermissions`, so the allowlist only matters for interactive sessions. The `PowerShell(...)` families are retired along with `agent-loop.ps1` (ADR-29 amended 2026-07-25).
- Getting prompted for something routine? Run `/fewer-permission-prompts` - it scans real transcripts and proposes evidence-based allowlist additions.
- Denied on purpose (don't relax): `npm`, `npx` and `yarn` (pnpm-only; `npx` was allowlisted until 2026-08-01, which left the rule bypassable - use `pnpm exec` or `pnpm dlx`), `git push --force`.

## Conventions the agents follow (so you can spot violations)

One task per PR/branch (`feat/NNN-slug`) · Conventional Commits with the task number · **no AI attribution trailers in commit messages** · green-or-clean, where green means **`pnpm verify`** (one command, a superset of CI's unit job; `pnpm verify:browser` adds the Playwright suite for portal/admin/`@qcms/ui` work) · never merge red · discoveries become issues (`phase-4` for cut-line itches), never scope creep · docs named in a task update in the same change.
