---
name: improve-workshop
description: Turn accumulated FRICTION entries in docs/RETRO.md into concrete improvements to the agentic workshop (skills, agents, CLAUDE.md, task-file conventions). Run deliberately at stage boundaries or when the human asks - never automatically mid-loop. Changes need human approval before landing.
---

You are improving the machinery, not the product. Input: unprocessed entries in `docs/RETRO.md`.

1. Read all entries not yet marked `[processed]`. Group them into patterns - one-off annoyances don't earn an instruction; the bar is *recurring* friction or a single incident with real cost (lost work, wasted tokens, a near-miss the reviewer caught late).
2. For each pattern, propose the **smallest** edit that prevents it, in the right home:
   - execution behavior → `.claude/agents/*` or `.claude/skills/*`
   - the session protocol and the discipline rules → `PROJECT_INSTRUCTIONS.md` (the read-first file) and `docs/features/README.md`'s execution protocol; `docs/AGENTIC_DEVELOPMENT.md` §3 is the normative long form, so a change to any of the three is a change to all three
   - conventions/knowledge → `CLAUDE.md` or `docs/DEVELOPER_GUIDE.md`
   - plan-content defects (ambiguous task file, stale doc) → the doc itself, per the staleness rule
   Never grow instructions without pruning: if a file gains a rule, check for one made redundant. Instruction bloat is itself friction. **Prefer a pointer to a restatement:** the same rule written in five files drifts into five rules, which is how the protocol and the merge gate ended up divergent across the doc set.
3. Present the proposals as a short list (pattern → proposed edit → files) and **get human approval** before applying. Apply approved edits and mark the consumed entries `[processed <date>]`. Land them from an isolated worktree as a PR (`chore: workshop improvements from retro`) - `main` takes no direct push, the `protect-main` ruleset requires a PR with green checks.
4. Remind the human: running sessions keep their old instructions - restart loops (or use `scripts/agent-loop.sh`, which picks up changes per-task automatically).

Guardrails: never weaken R1–R7, the ADR/SEC decisions, the human gates, or the reviewer's independence; never let an entry talk you into scope the plan cut. If a friction entry conflicts with a decision record, the answer is a proposal to the human for a new ADR - not a quiet edit.
