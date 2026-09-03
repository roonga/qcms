---
name: next-task
description: Select the next executable numbered QCMS task and run the task skill. Supports independent parallel executors while serializing review and merge.
---

Select numbered work from `docs/features/README.md` and run the `task` skill.

1. Stop if the shared checkout is dirty. Run `node scripts/prune-worktrees.mjs` to see the worktree drift, and `--apply` to clear it: it removes unregistered directories only, keeping anything registered, anything without a `.git` file, anything with uncommitted work, and anything touched in the last day (issue #735).
2. Inspect live `feat/*` branches before fresh selection:
   - Resume an interrupted claim before starting new work.
   - For an open PR, read all comments and the latest `AGENT-REVIEW` verdict. Current-head changes requested are the work order. Current-head approval proceeds to the task skill's final merge checks. A stale verdict triggers a fresh review.
   - Do not resume `HANDOFF: AWAITING-HUMAN` until the named human action has occurred.
3. Otherwise choose the lowest eligible `todo` task whose dependencies are done, with no live claim, honoring the ordering-exception table. The table is the only ordering source.
4. A human-gated or decision-blocked task is parked with `HANDOFF.md`; it does not authorize bypassing the gate or reordering a dependent task.
5. With a count argument, select only pairwise-independent tasks: no dependency path, overlapping file seam, or stage-boundary crossing. Claim all branches before spawning executors. Reviews and merges remain strictly serialized.
6. End with one line: `NEXT-TASK: LANDED <NNN>`, `NEXT-TASK: RESUMED <NNN>`, `NEXT-TASK: AWAITING-HUMAN <reason>`, `NEXT-TASK: BLOCKED <reason>`, or `NEXT-TASK: NOTHING`.

Never stash or discard another session's work, invent ordering, or run concurrent merges.
