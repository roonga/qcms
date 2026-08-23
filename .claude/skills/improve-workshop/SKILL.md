---
name: improve-workshop
description: Convert recurring QCMS workflow friction in docs/RETRO.md into small instruction or tooling improvements without weakening project rules.
---

Improve the workflow deliberately, outside active task execution.

1. Read unprocessed `FRICTION:` entries in `docs/RETRO.md` and group recurring patterns. One-off inconvenience does not justify a permanent instruction unless it caused lost work or a serious near miss.
2. Classify each pattern as an instruction problem, tooling problem, task-authoring problem, or training problem.
3. Propose the smallest durable fix. Prefer a check or script when enforceable; otherwise edit the narrowest authoritative instruction.
4. Remove obsolete or duplicated text whenever adding a rule. Prefer one source and links over restatement.
5. Mark consumed retro entries `[processed]` and summarize the change under `## Workshop log`.
6. Run checks applicable to the files changed and use the normal PR review flow.

Never weaken R1-R8, ADR or SEC decisions, explicit human gates, reviewer independence, or the launch cut-line. Conflicts with a decision become a recommendation to the Code Owner, not a quiet edit.
