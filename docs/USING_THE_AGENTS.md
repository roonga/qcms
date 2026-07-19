# Using the agents — developer guide

How to drive the qcms multi-agent development flow as the human in the loop. (What the *agents* must do lives in `CLAUDE.md` + `PROJECT_INSTRUCTIONS.md`; this file is for you.)

## Launching

```sh
cd H:\source\agent3\qcms
claude                                      # normal session — repo defaults to acceptEdits mode
claude --permission-mode bypassPermissions  # fully unattended (overnight loops) — per-run choice, deliberately not the repo default
```

Modes: the repo's `.claude/settings.json` sets **acceptEdits** (file edits and allowlisted commands run without prompting; anything unusual still asks). Shift+Tab cycles modes mid-session. For zero prompts, use the bypass flag above — only in a checkout you trust the agent with.

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
- **Screenshot gate (every UI task):** the agent presents static-render screenshots (screen × state × theme); reply with approval or corrections — wiring starts only after your OK.
- **Manual a11y pass (030):** you (or a tester) run NVDA/VoiceOver from the prepared script; results are logged to `docs/a11y-pass-<date>.md`.
- **Security review sign-off (040)** and the **external-tester launch gate (038)**: prepared by agents, executed by humans.

## Monitoring and control

- **State:** `docs/features/README.md` (the ledger) is always current; `git log --oneline` shows what landed; `git worktree list` shows live executors.
- **Interrupt safely:** Esc stops the current session; in-flight executor branches survive. A stopped task should end `blocked (…)`, `in-progress` with a committed `HANDOFF.md`, or be resumed later — `/next-task` prefers resuming handoffs over starting fresh.
- **Stale claim cleanup** (a session died mid-task): check the branch for a `HANDOFF.md`; either resume via `/task NNN`, or reset the ledger row to `todo`, delete the branch, and `git worktree remove` any leftover under `.claude/worktrees/`.

## Permissions tuning

- Allowlist lives in `.claude/settings.json` — **both** `Bash(...)` and `PowerShell(...)` families must be listed (rules are per-tool; this was the main cause of early prompt noise on Windows).
- Getting prompted for something routine? Run `/fewer-permission-prompts` — it scans real transcripts and proposes evidence-based allowlist additions.
- Denied on purpose (don't relax): `npm`/`yarn` (pnpm-only), `git push --force`.

## Conventions the agents follow (so you can spot violations)

One task per PR/branch (`feat/NNN-slug`) · Conventional Commits with the task number · **no AI attribution trailers in commit messages** · green-or-clean (never merge red) · discoveries become issues (`phase-4` for cut-line itches), never scope creep · docs named in a task update in the same change.
