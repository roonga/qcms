---
name: next-task
description: Pick the next executable todo task from the qcms ledger and run the /task flow on it. Designed to be run repeatedly via "/loop /next-task" for autonomous multi-task development. Honors ordering exceptions and stops at human gates.
---

Select and execute the single next task. One task per invocation — /loop provides the repetition.

1. Read the ledger (`docs/features/README.md`). Candidate = lowest-numbered `todo` task whose **Depends on** rows are all `done`, honoring the ordering exceptions:
   - 040 runs after 036 and before 038.
   - 041 runs any time after 034 and never gates 038.
   - 042 runs after 027 and before 029 and 031–035.
2. Skip (and report as awaiting-human) tasks that are human gates end to end: 038; 042 if its remaining work is only sign-off; 030's manual screen-reader portion (its automated portion may run). If the only remaining candidates are human gates or `blocked` rows, report exactly what the human must do and **stop the loop** (if running under /loop, end it — do not idle).
3. If a task is `in-progress` with a `HANDOFF.md` on its branch, prefer resuming it (via /task's executor with the handoff) over starting a new task.
4. Invoke the **task** skill with the selected number and let it run to completion.
5. End the invocation with a one-line status: what landed (or why nothing could), and what the next candidate will be.

Safety rails: never run two tasks concurrently on main; never reorder past a human gate; if the working tree is dirty at start, stop and report instead of stashing someone's work.
