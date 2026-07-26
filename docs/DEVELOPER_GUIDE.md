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

**Viewing the app from your host browser:** the dev servers listen on all interfaces inside the container (`next dev` and the Hono `serve()` both bind `0.0.0.0` by default, verified by the listen socket). The ports the container serves, **7000 and 7010**, leave it via `appPort` (published on the Docker host by **any** launcher, including a bare CLI `devcontainer up`) plus `forwardPorts` (the VS Code / Codespaces editor tunnel). `http://localhost:7000` on the host reaches the portal on either route: measured `200` from the host against a CLI-launched container running `pnpm exec next dev --port 7000`.

**7020 belongs to the host.** The dev Postgres from `docker-compose.dev.yml` publishes 7020 on the host, so the container must *not* claim it - if it did, whichever of the two started second would fail to bind. The container reaches it over the host gateway instead:

```sh
docker compose -f docker-compose.dev.yml up -d
pnpm dev:portal   # finds the dev DB itself; see CONTRIBUTING for why not host.docker.internal
```

**Where the portal's build output lands:** the production build (`pnpm build`, served by `next start`) writes `apps/portal/.next`; every dev server (`pnpm dev:portal`, and the one the Playwright suite boots) writes `apps/portal/.next-dev`. Two directories, deliberately (issue #54): `turbo.json` declares the portal build's outputs as `.next/**`, so while dev output lived under `.next` it was tarred into the build cache and a later `pnpm build` cache hit restored that stale snapshot, from any worktree, over the live dev directory. The dev server then died on a corrupt or stale Turbopack cache and the only visible symptom was a bare 180s Playwright `webServer` timeout. Split, `pnpm build` and `pnpm exec playwright test` work in either order with no manual clean. Both directories are gitignored, and `rm -rf apps/portal/.next-dev` is always safe: it discards no production build. That glob now also excludes `.next/dev` and `.next/cache` (issue #57), so the artifact holds only what `next build` produced.

**A turbo `outputs` glob must match only files the build itself writes.** turbo tars whatever matches when a task ends, so anything else that lives in those paths (a dev server's directory, a runtime cache, a log) is captured and restored over the live copy on the next cache hit, in any worktree.

If a Testcontainers-backed suite cannot reach the container it just started (sibling containers, not children), set `TESTCONTAINERS_HOST_OVERRIDE`. It has never been needed here. Prefer the default-route gateway over `host.docker.internal` if you do need it, for the Postgres-session reason noted above.

**What the container takes over from your machine** (ports 7000/7010, `node_modules` and the pnpm store, the Docker daemon), how to run the app inside it, and the full troubleshooting table are in [`DEV_CONTAINER.md`](DEV_CONTAINER.md). The rule that bites first: **only one qcms dev container runs at a time**, machine-wide.

**Rollback (the migration is reversible):** `.devcontainer/` touches no product code. Stop using it - or delete the directory - and the host workflow is unchanged: `pnpm install`, the merge gate, and `docker compose -f docker-compose.dev.yml up -d` behave exactly as they did before task 046 (re-run `pnpm install` on the host once if that checkout had been used in the container). Task 046 verified that the portal and API dev servers already bind `0.0.0.0` by default, so no source change was needed for host-browser viewing.

## Running work

| You type | What happens |
|---|---|
| `/task 002` | One plan task, full relay: **claim** (ledger row → `in-progress`, committed) → **task-executor** implements in an isolated worktree on `feat/002-slug` → *(UI tasks: pauses at the screenshot gate for your sign-off)* → **task-reviewer** verifies every exit criterion + rule against the diff → rebase onto current main, re-run gates, squash-merge → ledger → `done`. |
| `/next-task` | Picks the next executable `todo` (numeric order; exceptions: 040 after 036 before 038 · 041 after 034 · 042 after 027 before UI tasks) and runs the `/task` flow. |
| `/loop /next-task` | Autonomous run, task after task. Stops at human gates, on blocks, or when nothing is executable. |
| `/loop /next-task 3` | Same, up to 3 **pairwise-independent** tasks per batch (parallel executors, serialized merges). |
| `/next-issue` | Picks the next actionable GitHub issue by label tier (`security` > `bug` > unlabeled > `enhancement`; the routing labels `needs-decision`/`blocked-upstream`/`workshop`/`admin-stage` and `phase-4` are excluded) and runs the same executor+reviewer relay on `fix/NN-slug` - then **opens one PR per issue** (body: acceptance checklist, `Fixes #NN`, reviewer verdict, retro lines; respondent-visible changes carry gate screenshots under `docs/gates/pr-NN/`). The conductor never merges. |
| `/next-issue 3` / `/loop /next-issue 3` | Up to 3 **pairwise-independent** issues per batch (disjoint packages/seams; when in doubt, not batched) - own claim, executor worktree, reviewer, and PR each, no cross-batch barrier. Safe because conductors never merge; the PO loop serializes landings. |
| `/loop /next-issue` | Issue after issue until nothing is executable or a stated repo-wide blocker. Human gates park **the PR**, never the run; an open PR whose newest `PO-REVIEW: CHANGES-REQUESTED @<headRefOid>` sentinel (the full head SHA) matches the current head is picked up as a findings cycle before fresh work. |

Issue PRs are reviewed and squash-merged by the **PO seat's review loop** (procedure: `plan/pr-review-loop.md`): stranger review, a Copilot-comment sweep where every comment gets a fix or a reasoned reply, verdicts ending in a head-bound `PO-REVIEW:` sentinel, merge when every check concludes SUCCESS except at most the node-26 `verify` leg, which is `continue-on-error` by design and may be waived with the waiver recorded in the verdict, then the retro append. You can also review and merge yourself - the sentinel comment is the only protocol.

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

One task per PR/branch (`feat/NNN-slug`) · Conventional Commits with the task number · **no AI attribution trailers in commit messages** · green-or-clean, where green means **`pnpm verify`** (one command, a superset of CI's unit job; `pnpm verify:browser` adds the Playwright suite for portal/admin/`@qcms/ui` work) · never merge red · discoveries become issues (`phase-4` for cut-line itches), never scope creep · docs named in a task update in the same change.
