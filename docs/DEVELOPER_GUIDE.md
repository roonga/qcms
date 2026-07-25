# QCMS - Developer Guide

> **Methodology vs. runbook:** this is the *operator's runbook* - how to drive the build day-to-day. For the *why* (principles, task-design rules, the session protocol, the audit checklist) see [`AGENTIC_DEVELOPMENT.md`](AGENTIC_DEVELOPMENT.md).

How to drive the QCMS multi-agent development flow as the human in the loop. (What the *agents* must do lives in `CLAUDE.md` + `PROJECT_INSTRUCTIONS.md`; this file is for you.)

## Launching

**The canonical seat is inside the dev container (ADR-29).** The container is the blast radius, which is what makes `bypassPermissions` a responsible default for the loop rather than a gamble.

```sh
# From the repo root on the host (WSL2/Linux/macOS):
pnpm dlx @devcontainers/cli up --workspace-folder .        # first run: several minutes
pnpm dlx @devcontainers/cli exec --workspace-folder . zsh  # a shell inside
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

Modes: the repo's `.claude/settings.json` sets **acceptEdits** (file edits and allowlisted commands run without prompting; anything unusual still asks). Shift+Tab cycles modes mid-session. For zero prompts, use the bypass flag above.

**What the container gives the loop:** Node 24 + pnpm at the pinned version, Docker (the host daemon, mounted in) so Testcontainers works, the GitHub CLI, Playwright's Chromium with its OS libraries, zsh, and the Claude Code CLI. `CLAUDE_CONFIG_DIR` points at the mounted `~/.claude`, which puts `.claude.json` (the account/OAuth state) inside the mount too, so your host login carries straight into the container and survives rebuilds. Verified in task 046: `claude -p "..." --permission-mode bypassPermissions` runs headless inside the container, already authenticated, with zero prompts.

**Trust the workspace once for interactive sessions.** A fresh container prints `Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted`. Under `bypassPermissions` this is harmless (nothing is being gated), but an *interactive* session in the container will keep asking until you accept the trust dialog once, or set `projects["/workspaces/<folder>"].hasTrustDialogAccepted: true` in `~/.claude/.claude.json`.

**Viewing the app from your host browser:** the dev servers listen on all interfaces inside the container (`next dev` and the Hono `serve()` both bind `0.0.0.0` by default, verified by the listen socket). The ports the container serves, **7000 and 7010**, leave it via `appPort` (published on the Docker host by **any** launcher, including a bare CLI `devcontainer up`) plus `forwardPorts` (the VS Code / Codespaces editor tunnel). `http://localhost:7000` on the host reaches the portal on either route: measured `200` from the host against a CLI-launched container running `pnpm exec next dev --port 7000`.

**7020 belongs to the host.** The dev Postgres from `docker-compose.dev.yml` publishes 7020 on the host, so the container must *not* claim it - if it did, whichever of the two started second would fail to bind. The container reaches the database by name instead:

```sh
docker compose -f docker-compose.dev.yml up -d
DATABASE_URL=postgres://qcms:qcms@host.docker.internal:7020/qcms pnpm dev:portal
```

If a Testcontainers-backed suite cannot reach the container it just started (sibling containers, not children), set `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`.

**What the container takes over from your machine.** It is additive to the repo but shares three host resources: **ports 7000/7010** (published via `appPort`, so anything already holding one blocks container creation - a host process, or a dev container from another checkout; only one qcms dev container runs at a time, machine-wide), **`node_modules` + the pnpm store** (the workspace is bind-mounted, so the in-container `pnpm install` relinks `node_modules` to the container's store; host-side pnpm in that same checkout then fails with `ERR_PNPM_MISSING_PACKAGE_INDEX_FILE` until you re-run `pnpm install` on the host), and **the Docker daemon** (mounted socket, so Testcontainers spins sibling containers visible to your host `docker ps` - ADR-29's recorded trade-off). Port 7020 is deliberately left to the host's dev Postgres. Practical rule: one container machine-wide, and one side per checkout at a time, or keep a second `git worktree` for host-side work. The dev container is named `qcms-dev-container` and the dev database `qcms-dev-postgres-1`, both under the `qcms-dev` compose project, so `docker stop qcms-dev-container` is the fix when a stale one holds the ports. Inside the container `pnpm dev:portal` reaches the database through `QCMS_DB_HOST=host.docker.internal` (preset in `devcontainer.json`), because the compose database is a sibling on the host, not on this container's localhost. Full table in [`CONTRIBUTING.md`](../CONTRIBUTING.md#development-environment).

**Rollback (the migration is reversible):** `.devcontainer/` touches no product code. Stop using it - or delete the directory - and the host workflow is unchanged: `pnpm install`, the merge gate, and `docker compose -f docker-compose.dev.yml up -d` behave exactly as they did before task 046 (re-run `pnpm install` on the host once if that checkout had been used in the container). Task 046 verified that the portal and API dev servers already bind `0.0.0.0` by default, so no source change was needed for host-browser viewing.

## Running work

| You type | What happens |
|---|---|
| `/task 002` | One plan task, full relay: **claim** (ledger row → `in-progress`, committed) → **task-executor** implements in an isolated worktree on `feat/002-slug` → *(UI tasks: pauses at the screenshot gate for your sign-off)* → **task-reviewer** verifies every exit criterion + rule against the diff → rebase onto current main, re-run gates, squash-merge → ledger → `done`. |
| `/next-task` | Picks the next executable `todo` (numeric order; exceptions: 040 after 036 before 038 · 041 after 034 · 042 after 027 before UI tasks) and runs the `/task` flow. |
| `/loop /next-task` | Autonomous run, task after task. Stops at human gates, on blocks, or when nothing is executable. |
| `/loop /next-task 3` | Same, up to 3 **pairwise-independent** tasks per batch (parallel executors, serialized merges). |

**Never run two interactive sessions in one checkout.** If you want a second hands-on session, give it its own `git worktree add ../qcms-me main`.

## Your gates (the agent stops and waits for you)

- **Wireframe sign-off (042):** review `docs/wireframes/*.md`, then flip each file's status line to `Signed off: <you>, <date>`.
- **Screenshot gate (every UI task):** the agent presents static-render screenshots (screen × state × theme); reply with approval or corrections - wiring starts only after your OK.
- **Manual a11y pass (030):** you (or a tester) run NVDA/VoiceOver from the prepared script; results are logged to `docs/a11y-pass-<date>.md`.
- **Security review sign-off (040)** and the **external-tester launch gate (038)**: prepared by agents, executed by humans.

## Surviving usage limits (true unattended runs)

An in-session `/loop` dies when your Claude usage window closes and **won't self-restart** - nothing inside a session can wake itself hours later. For runs that should outlast limit windows, use the supervisor instead:

```sh
# Run it inside the dev container (ADR-29) - that is what makes bypassPermissions safe.
bash scripts/agent-loop.sh                  # one task at a time
bash scripts/agent-loop.sh --parallel 3     # up to 3 independent tasks per batch
bash scripts/agent-loop.sh --help           # all options
```

This is the only supervisor. `agent-loop.ps1` was **retired** (ADR-29 amended 2026-07-25): a Windows contributor's supported path is the container itself, via Docker Desktop or Codespaces. Outside the container the interactive fallback is `/loop /next-task`, which does not survive a usage-limit window.

The script runs `/next-task` in a **fresh headless session per iteration** (safe because the repo is the memory: claims, branches, HANDOFFs), reads the `NEXT-TASK:` sentinel each session emits, and: continues immediately on `LANDED`/`RESUMED`, stops on `AWAITING-HUMAN`/`BLOCKED`/`NOTHING`, and on *no sentinel* (usage limit or crash) waits the retry interval (`--retry-minutes`, default 30) and retries - the next session's stale-claim recovery picks up whatever the killed one left mid-flight. Progress is in `agent-loop.log` and, as always, the ledger.

## Editing skills/agents while a loop is running

A long-lived session follows the instructions it already read - edits to `.claude/skills/` or `.claude/agents/` land on disk but a running conductor may keep executing the old flow from memory. After changing any skill or agent file: **restart running sessions**, or (better) run via `scripts/agent-loop.sh`, whose fresh-session-per-task model picks up the current files on every iteration by construction.

## Monitoring and control

- **State:** `docs/features/README.md` (the ledger) is always current; `git log --oneline` shows what landed; `git worktree list` shows live executors.
- **Interrupt safely:** Esc stops the current session; in-flight executor branches survive. A stopped task should end `blocked (…)`, `in-progress` with a committed `HANDOFF.md`, or be resumed later - `/next-task` prefers resuming handoffs over starting fresh.
- **Stale claim cleanup** (a session died mid-task): check the branch for a `HANDOFF.md`; either resume via `/task NNN`, or reset the ledger row to `todo`, delete the branch, and `git worktree remove` any leftover under `.claude/worktrees/`.

## Permissions tuning

- Allowlist lives in `.claude/settings.json`, as `Bash(...)` families (rules are per-tool). Inside the dev container the loop runs in `bypassPermissions`, so the allowlist only matters for interactive sessions. The `PowerShell(...)` families are retired along with `agent-loop.ps1` (ADR-29 amended 2026-07-25).
- Getting prompted for something routine? Run `/fewer-permission-prompts` - it scans real transcripts and proposes evidence-based allowlist additions.
- Denied on purpose (don't relax): `npm`/`yarn` (pnpm-only), `git push --force`.

## Conventions the agents follow (so you can spot violations)

One task per PR/branch (`feat/NNN-slug`) · Conventional Commits with the task number · **no AI attribution trailers in commit messages** · green-or-clean (never merge red) · discoveries become issues (`phase-4` for cut-line itches), never scope creep · docs named in a task update in the same change.
