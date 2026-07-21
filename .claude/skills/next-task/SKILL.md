---
name: next-task
description: Pick the next executable todo task(s) from the qcms ledger and run the /task flow. "/next-task" runs one; "/next-task 3" runs up to three pairwise-independent tasks with parallel executors and serialized merges. Designed for "/loop /next-task". Honors ordering exceptions and stops at human gates.
---

Select and execute the next task - or, with a count argument N, up to N **pairwise-independent** tasks in parallel. One batch per invocation; /loop provides the repetition.

**Housekeeping first (self-healing worktree cleanup).** Before selecting, reclaim orphaned worktrees: run `git worktree prune`, then `rm -rf` any `.claude/worktrees/agent-*` directory that does **not** appear in `git worktree list`. On Windows, `git worktree remove` (task step 8) commonly deregisters a worktree but leaves its folder behind (locked `node_modules`/`.turbo`, long paths), so orphaned dirs accumulate and waste disk; this sweep is the backstop that keeps the loop self-healing. Never remove a dir that IS a live registered worktree.

1. Read the ledger (`docs/features/README.md`). Candidate = lowest-numbered `todo` task whose **Depends on** rows are all `done`, honoring the ordering exceptions:
   - 040 runs after 036 and before 038.
   - 041 runs any time after 034 and never gates 038.
   - 042 runs after 027 and before 029 and 031–035.
   - 043 (neutral-domain rename, #16) runs after 029 and before 030 and 031–035.
2. Skip (and report as awaiting-human) tasks that are human gates end to end: 038; 042 if its remaining work is only sign-off; 030's manual screen-reader portion (its automated portion may run). If the only remaining candidates are human gates or `blocked` rows, report exactly what the human must do and **stop the loop** (if running under /loop, end it - do not idle).
3. **Stale-claim recovery (interrupted sessions - usage limits, crashes).** If a task is `in-progress` and no live session owns it, resume it before starting anything new:
   - Branch has a committed `HANDOFF.md` → dispatch the executor with the handoff.
   - Branch exists but no `HANDOFF.md` (the session died mid-task) → dispatch the executor with: "task NNN was interrupted; reconstruct state from `git log`/`git diff main...<branch>` and the task file, then continue on this branch." Remove any leftover worktree for it first.
   - Claim exists but no branch → the claim is vapor; reset the row to `todo` and treat as fresh.
4. **Serial (no count argument):** invoke the **task** skill with the selected number and let it run to completion.
5. **Parallel (count N given):** extend the selection to up to N candidates that are **pairwise independent**:
   - No dependency path between any two selected tasks (check `Depends on` transitively).
   - Disjoint expected file footprints - different packages or different slice folders. When in doubt about overlap, don't parallelize; drop to the smaller set.
   - Claim all selected rows first (ledger commits to main, one per task - the /task claim step), then spawn one **task-executor** per task in parallel worktrees.
   - Executors run concurrently; **review and land strictly one at a time** as each finishes, per /task steps 5–6 (each merge rebases onto the moved main and re-runs the gates). The conductor is the only writer to main and the ledger, ever.
6. End the invocation with a one-line human summary **and, as the very last output line, a machine-readable sentinel** (the supervisor script keys off it): `NEXT-TASK: LANDED <NNN>` · `NEXT-TASK: RESUMED <NNN>` · `NEXT-TASK: AWAITING-HUMAN <gate>` · `NEXT-TASK: BLOCKED <NNN> <reason>` · `NEXT-TASK: NOTHING`. Emit exactly one sentinel, always.

Safety rails: merges are serialized no matter how many executors run; never reorder past a human gate; if the working tree is dirty at start, stop and report instead of stashing someone's work; parallel batches never span a stage boundary (a stage's exit criteria gate the next stage).
