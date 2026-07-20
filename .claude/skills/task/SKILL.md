---
name: task
description: Execute one numbered qcms plan task end to end with the multi-agent flow - task-executor implements on a branch, task-reviewer verifies, merge on approval, ledger updated. Use "/task 002" or "/task 017". Stops at human gates instead of simulating them.
---

Orchestrate exactly one plan task. You coordinate; the subagents do the work.

Input: a task number NNN (from the argument). Resolve it to `docs/features/<NNN>-*.md`.

1. **Pre-flight.** Read the ledger (`docs/features/README.md`). Refuse if: the task isn't `todo` (report its state - `in-progress` means another session/agent has claimed it), a **Depends on** entry isn't `done`, or the task is a human gate that cannot be executed autonomously (038 launch validation; 040's sign-off; 042's sign-off - preparation parts may run, the sign-off may not). Announce the plan: task title, branch name `feat/NNN-slug`.
2. **Claim.** Before spawning anything, set the ledger row to `in-progress (feat/NNN-slug)` and commit that one-line change to `main`. The ledger on `main` is the claim lock - parallel orchestrators must re-read it after committing; if someone else claimed first (your commit conflicts or their claim predates yours), release and re-pick.
3. **Execute.** Spawn the **task-executor** agent (worktree isolation) with the task number and branch name. Do not implement in this session - context separation is the point. Executors never touch the ledger or `main`.
4. **Handle the executor's report.**
   - *Not done / parked:* update the ledger row to `blocked (…)` or leave `in-progress (branch)` per the report, relay the handoff to the user, stop.
   - *Blocked on a decision:* relay the question to the user verbatim, stop.
   - *Screenshot gate reached (UI tasks):* present the screenshot set to the user for sign-off; on approval, re-invoke the executor (SendMessage - same agent, context intact) to wire behavior.
   - *Done:* continue.
5. **Review.** Spawn the **task-reviewer** agent with the task number and branch. On REJECT: relay findings to the executor (SendMessage) for fixes - at most two fix cycles, then park with `HANDOFF.md` and report to the user. On APPROVE: continue.
6. **Land (serialized - one merge at a time, ever).** Rebase the task branch onto the *current* `main` (it may have moved while this task ran) - **reconcile by rebase only; never `git reset --hard origin/<branch>` an executor branch** (executors don't push their work, so the local ref is the source of truth - a reset-to-origin silently discards their commits). Re-run `pnpm build && pnpm typecheck && pnpm test && pnpm lint` at root **after** the rebase - checks are snapshots and vouch only for the tree they ran against. If the task touched a Docker-backed package (db/integration/e2e), **force-run its suite** (`turbo run test --filter=<pkg> --force`) before merging - turbo cache replays logs that mimic a live pass without booting a container - and confirm nonzero per-file test counts (a misresolved test `root` matches zero files and still reports green). Then squash-merge to main with a Conventional Commit carrying the task number, update the ledger row to `done` in the same commit, and **push main to origin** (plain push - never force) so GitHub CI runs and the remote ledger stays current. If the rebase conflicts nontrivially, hand the conflict back to the executor (SendMessage) rather than resolving blind. Report: what landed, suites run, discoveries that need issues filed.
7. **Log the retro.** Append the executor's and reviewer's `FRICTION:` lines (skip `none`) to `docs/RETRO.md` under `## NNN - <task title>` with today's date, in the landing commit. Capture only - improving the workshop is `/improve-workshop`'s job, run deliberately at stage boundaries, never mid-task.
8. **Clean up the worktree - always.** After landing (or abandoning), remove the executor's worktree: `git worktree remove --force <path>` for anything under `.claude/worktrees/` belonging to this task, then `git worktree prune`. This is safe in every outcome: merged work lives on main, parked work lives on the task branch (with its committed `HANDOFF.md`) - the worktree directory itself never holds the only copy of anything. After a merge, also delete the merged `feat/NNN-slug` branch.
8. **On abandonment** (parked, blocked, or fix cycles exhausted): update the claim honestly - `blocked (issue)` or leave `in-progress (branch)` with the `HANDOFF.md` - never leave a stale claim that reads as active work. The branch stays; the worktree still goes (step 7).

Never: merge red, skip the reviewer, extend the task's scope yourself, or perform a human sign-off on the user's behalf.
