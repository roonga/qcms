# QCMS - Dev container

The dev container is the canonical development environment (ADR-29): one preinstalled Ubuntu 24.04 box with Node 24, pnpm at the `packageManager` pin, Docker access, the GitHub CLI, Playwright's Chromium, zsh, and the Claude Code CLI. Running the host toolchain directly is still fully supported; the container removes the "works on my machine" class of problem, and it is what makes `--permission-mode bypassPermissions` a responsible default for the autonomous loop, because the container is the blast radius.

**Prerequisites:** Docker (Docker Desktop, or Docker Engine under WSL2/Linux), and either the VS Code **Dev Containers** extension or nothing at all - the CLI route needs no global install.

## Starting it from a terminal

```sh
cd <your qcms checkout>
pnpm devcontainer up       # build/start; reuses a running container
pnpm devcontainer shell    # zsh inside, at /workspaces/qcms
```

`shell` is repeatable: run it in as many terminals as you like. Exiting the shell leaves the container running.

First start pulls the base image and runs `.devcontainer/post-create.sh` (corepack, `pnpm install --frozen-lockfile`, `playwright install --with-deps chromium`), so budget several minutes. Later starts take seconds. Those three steps retry on a transient registry failure rather than aborting the build and leaving a half-provisioned container.

## Every command

| Command | What it does |
|---|---|
| `pnpm devcontainer up` | Build or start. Reuses a running container. |
| `pnpm devcontainer shell` | Open zsh inside, in the workspace. |
| `pnpm devcontainer run '<cmd>'` | Run one command inside and exit, e.g. `run 'pnpm build'`. |
| `pnpm devcontainer status` | What is running, its ports, the dev database, and whether the config has drifted. |
| `pnpm devcontainer rebuild` | Recreate from scratch. **Required after editing `devcontainer.json`.** |
| `pnpm devcontainer stop` | Stop the container. There is no `devcontainer down`. |

In VS Code, *Reopen in Container* does the same thing, and its integrated terminal is already inside.

**`stop`, `down` and `rebuild` refuse to run from inside the container they target.** The container mounts the host Docker socket so Testcontainers works (ADR-29), which also means a process inside it can destroy the container it is running in, killing every session in there with no surviving process able to report why. That happened on 2026-08-01: a clean exit 0, 4m38s of downtime, and a `137` from the killed processes that reads exactly like an out-of-memory kill (issues #244, #260). Run those three from the host. The guard identifies the container by the `QCMS_DEVCONTAINER` marker in `containerEnv`, falling back to matching the shell's hostname against the container id, because `containerEnv` does not reach a container that is already running.

### Why a wrapper rather than the raw CLI

The raw equivalents work fine:

```sh
devcontainer up --workspace-folder .    # or: pnpm dlx @devcontainers/cli up --workspace-folder .
docker exec -it -u vscode -w /workspaces/qcms qcms-dev-container zsh
```

The wrapper exists for three things that are easy to get wrong:

- **`up` silently reuses a running container** and ignores changed `runArgs`, `appPort` and `containerEnv`. An edited `devcontainer.json` appears to apply and does not. `status` and `shell` warn when the config is newer than the running container; `rebuild` is the fix.
- **`docker exec` defaults to root**, which writes root-owned files into the bind mount and breaks your next run as `vscode`. The wrapper always uses `-u vscode`.
- **`rebuild` removes the container by name.** `--remove-existing-container` finds it through a `devcontainer.local_folder` label, and the launchers disagree about the same folder: VS Code on Windows records a UNC path, the CLI under WSL2 records a POSIX one. A container created in the editor is invisible to the CLI, so nothing is removed and the fixed name then collides.

The wrapper falls back to `pnpm dlx @devcontainers/cli`, so no global install is needed.

## What is running

Everything is named and grouped, so `docker ps` reads at a glance and Docker Desktop shows one stack:

| Container | What |
|---|---|
| `qcms-dev-container` | the dev container itself |
| `qcms-dev-postgres-1` | the dev database from `docker-compose.dev.yml` |

Both carry the `qcms-dev` compose project, and the database keeps that name whatever your checkout folder is called. Testcontainers spawns its own short-lived containers with generated names: those belong to a test run, not the dev stack.

## Running the app

```sh
pnpm dev:portal
```

Brings the dev database up, seeds and publishes the kitchen-sink form, then starts the API and the portal on this machine seat's ports. At the default seat 0 that is 7010 and 7000: open **`http://localhost:7000/f/kitchen-sink`** in your *host* browser. The allocation, the seat scheme and the runbook are in [`docs/PORTS.md`](PORTS.md), which is the only place the table is written down.

The dev servers listen on all interfaces inside the container (`next dev` and Hono's `serve()` both bind `0.0.0.0` by default). Ports **7000** and **7010** leave the container two ways: `appPort` publishes them on the Docker host under any launcher including a bare CLI `up`, and `forwardPorts` adds the VS Code / Codespaces editor tunnel with labels. If you launch the container by hand with plain `docker run`, publish them yourself (`-p 7000:7000 -p 7010:7010`).

**The database is not on this container's localhost.** `docker compose` inside the container talks to the host daemon, so the database starts as a *sibling* published on the host's loopback. `dev:portal` detects this and connects over the default-route gateway. On a host checkout it uses plain `localhost`. `QCMS_DB_HOST` overrides both.

> Do not "fix" that by setting `QCMS_DB_HOST=host.docker.internal`. On Docker Desktop that address accepts a TCP connection and then times out on a real Postgres session, so a reachability check passes while the app still fails. It was measured wrong once already.

## What the container takes over from your machine

It is additive to the *repo* but not invisible to your *machine*. The conflict rule differs per row. Ports in particular do not hand over to the newcomer: whoever holds them first wins, and the second arrival fails to start.

| Resource | What happens | Consequence |
|---|---|---|
| Ports 7000 / 7010 (seat 0) | Published on the Docker host via `appPort` | Anything already holding them blocks container creation: a host process, or a dev container from another checkout. **As shipped, one qcms dev container runs at a time, machine-wide** - `appPort` is static and `--name=qcms-dev-container` is fixed, so a second one collides on the name before it collides on a port. Stop the other first: `pnpm devcontainer stop`, or `docker stop qcms-dev-container`. A second *seat* is designed for and documented in [`docs/PORTS.md`](PORTS.md), but running two containers has not been exercised; the tested second-seat path is a host checkout with `QCMS_PORT_SEAT` set. |
| Port 7020 (seat 0) | **Not** taken by the container; owned by host `docker-compose.dev.yml` | Safe by design. Do not add it to `appPort`, or the database and the container will fight over it ([`docs/PORTS.md`](PORTS.md) explains why). |
| `node_modules/` + the pnpm store | The workspace is bind-mounted, so the in-container `pnpm install` relinks `node_modules` to the container's store | Host-side pnpm in that checkout can then fail with `ERR_PNPM_MISSING_PACKAGE_INDEX_FILE`. Recover with `pnpm install` on the host, which relinks it back. |
| Docker daemon | Mounted host socket (`docker-outside-of-docker`) | Testcontainers starts *sibling* containers on your host, visible to `docker ps`. ADR-29 records this trade-off. |

The practical rule: **one container machine-wide, and one side per checkout at a time.** (That is a property of the shipped devcontainer config, not of the port allocation: [`docs/PORTS.md`](PORTS.md) defines seats 0-9 and what a second seat would need.) A second checkout is fine for editing, but its container will not start while another holds the ports. Alternating host and container pnpm in one directory is supported but costs a re-`install` each way; if you switch often, keep a second `git worktree` for the host side.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Bind for 0.0.0.0:7020 failed: port is already allocated` | Another dev database already holds seat 0's database port, often from an older checkout. `docker ps -a --filter publish=7020`, then `docker rm -f <name>`. Or take another seat: `QCMS_PORT_SEAT=1 pnpm dev:portal` ([`docs/PORTS.md`](PORTS.md)). |
| Container creation fails on 7000 or 7010 | A host process or another qcms dev container holds them. `pnpm devcontainer status`, then stop the other one. |
| `The container name "/qcms-dev-container" is already in use` | A stopped container still holds the name. `pnpm devcontainer rebuild` removes it by name first. |
| Config edits seem to have no effect | `up` reused the container. `pnpm devcontainer rebuild`. `status` warns when this has happened. |
| `ERR_PNPM_MISSING_PACKAGE_INDEX_FILE` on the host | That checkout's `node_modules` is linked to the container's pnpm store. Run `pnpm install` on the host. |
| `eval() is not supported in this environment` in the browser console | Expected. Next runs React's development build, which uses `eval()`; the portal's CSP (SEC-9) forbids `unsafe-eval`. React never uses it in production, so the shipped build cannot hit this, and weakening the CSP is not an option. |
| Interactive Claude sessions keep asking about permissions | Accept the workspace trust dialog once, or set `projects["/workspaces/qcms"].hasTrustDialogAccepted: true` in `~/.claude/.claude.json`. Harmless under `bypassPermissions`. |
| A Testcontainers suite cannot reach the container it started | Set `TESTCONTAINERS_HOST_OVERRIDE`. It has never been needed here. Prefer the default-route gateway over `host.docker.internal`, for the Postgres-session reason above. |

## Secrets

Provisioned at runtime, never committed. `.env` (gitignored) arrives with the workspace mount, and both `~/.claude` (Claude Code login) and `~/.config/gh` (gh CLI token) are bind-mounted from the host, so each survives rebuilds: run `gh auth login` once on the WSL2 host and every container inherits it (a rebuild on 2026-07-26 severed in-container gh auth and blocked the PR-review loop for a day, which is why the mount exists). `pnpm devcontainer shell` warns before dropping you into an unauthenticated container - that warning almost always means the HOST is not logged in. `.env.example` stays the only committed env file, and no secret value appears anywhere in `.devcontainer/`.

## Codespaces

The same `devcontainer.json` drives GitHub Codespaces: use the badge in `README.md`, or *Code -> Codespaces -> Create codespace*.

## Rollback

The container changes no product code. Delete `.devcontainer/`, or simply never open the repo in a container, and every host workflow is unchanged: `pnpm install`, the merge gate, and `docker compose -f docker-compose.dev.yml up -d` behave exactly as before. If that checkout had been used in the container, run `pnpm install` once on the host to relink `node_modules` to the host store.
