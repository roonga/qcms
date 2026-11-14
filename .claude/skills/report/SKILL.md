---
name: report
description: Short QCMS progress report for the current program - done, in progress and up next, by task title. Use when the Code Owner says "/report", "status", "what's running" or "where are we".
---

Report progress in three short lists. Read-only: start nothing, merge nothing.

1. Gather state from `origin/main` and GitHub, not chat memory:
   - `git fetch origin`, then the ledger in `docs/features/README.md` for the current program's tasks, titles and dependencies.
   - `gh pr list --state open` for task branches, with any `AGENT-REVIEW` verdict and CI state.
   - `HANDOFF.md` on each open `feat/*` or `fix/*` branch for parked work and its reason.
   - Background agents this session started that are still running.
2. Write the report with short descriptions only: the task title in plain words, never task, PR or issue numbers unless the Code Owner asks for them.

```
**Done**
- <title>

**In progress**
- **<title>:** <stage in a few words: building, gates running, in review, awaiting Code Owner on <what>>

**Up next**
- <title> (ready now | after <title>)
- Then: <remaining titles, comma-separated, grouped where natural>
```

- **Done** lists only the current program's merged tasks, most recent last.
- **In progress** names anything waiting on the Code Owner and what is needed.
- **Up next** gives the next few in dependency order, then one line for the rest.
- No preamble, no closing summary, no tables.
