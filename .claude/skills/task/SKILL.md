---
name: task
description: Execute one numbered qcms plan task end to end with the multi-agent flow - task-executor implements on a branch, task-reviewer verifies, merge on approval, ledger updated. Use "/task 002" or "/task 017". Stops at human gates instead of simulating them.
---

Orchestrate exactly one plan task. You coordinate; the subagents do the work.

Input: a task number NNN (from the argument). Resolve it to `docs/features/<NNN>-*.md`.

1. **Pre-flight.** Read the ledger (`docs/features/README.md`). Refuse if: the task isn't `todo` (report its state — `in-progress` means another session/agent has claimed it), a **Depends on** entry isn't `done`, or the task is a human gate that cannot be executed autonomously (038 launch validation; 040's sign-off; 042's sign-off — preparation parts may run, the sign-off may not). Announce the plan: task title, branch name `feat/NNN-slug`.
2. **Claim.** Before spawning anything, set the ledger row to `in-progress (feat/NNN-slug)` and commit that one-line change to `main`. The ledger on `main` is the claim lock — parallel orchestrators must re-read it after committing; if someone else claimed first (your commit conflicts or their claim predates yours), release and re-pick.
3. **Execute.** Spawn the **task-executor** agent (worktree isolation) with the task number and branch name. Do not implement in this session — context separation is the point. Executors never touch the ledger or `main`.
4. **Handle the executor's report.**
   - *Not done / parked:* update the ledger row to `blocked (…)` or leave `in-progress (branch)` per the report, relay the handoff to the user, stop.
   - *Blocked on a decision:* relay the question to the user verbatim, stop.
   - *Screenshot gate reached (UI tasks):* present the screenshot set to the user for sign-off; on approval, re-invoke the executor (SendMessage — same agent, context intact) to wire behavior.
   - *Done:* continue.
5. **Review.** Spawn the **task-reviewer** agent with the task number and branch. On REJECT: relay findings to the executor (SendMessage) for fixes — at most two fix cycles, then park with `HANDOFF.md` and report to the user. On APPROVE: continue.
6. **Land (serialized — one merge at a time, ever).** Rebase the task branch onto the *current* `main` (it may have moved while this task ran); re-run `pnpm build && pnpm test && pnpm lint` at root **after** the rebase — checks are snapshots and vouch only for the tree they ran against. Then squash-merge to main with a Conventional Commit carrying the task number and update the ledger row to `done` in the same commit. If the rebase conflicts nontrivially, hand the conflict back to the executor (SendMessage) rather than resolving blind. Report: what landed, suites run, discoveries that need issues filed.
7. **On abandonment** (parked, blocked, or fix cycles exhausted): update the claim honestly — `blocked (issue)` or leave `in-progress (branch)` with the `HANDOFF.md` — never leave a stale claim that reads as active work.

Never: merge red, skip the reviewer, extend the task's scope yourself, or perform a human sign-off on the user's behalf.
