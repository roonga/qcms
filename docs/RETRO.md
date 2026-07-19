# Workshop retro log

`FRICTION:` observations from executors and reviewers, appended by `/task` at each landing. Consumed by `/improve-workshop` (run at stage boundaries); processed entries get marked `[processed <date>]`, never deleted — this is also the audit trail of how the workshop evolved.

Seed entries (from the 2026-07-19/20 manual improvement pass, recorded retroactively so the pattern history starts complete):

## 001–008 — workshop shakedown [processed 2026-07-20]
- Executor worktrees leaked to disk and once into git → cleanup step + gitignore added to /task.
- Landings weren't pushed; 13 commits piled up locally → push-on-land added to /task.
- Usage-limit kills lost uncommitted work and stalled the loop → incremental WIP commits, stale-claim recovery, NEXT-TASK sentinel + scripts/agent-loop.ps1 supervisor.
- Skill edits didn't affect the running session → restart guidance; supervisor preferred for long runs.

## 009 — Answer validation and submission lock (2026-07-20)
- Reviewer: exit criterion "contentHash stable across Node versions" is only indirectly verifiable on one machine — the committed golden hash is the cross-version tripwire; a CI matrix over Node versions would make it directly checkable.
