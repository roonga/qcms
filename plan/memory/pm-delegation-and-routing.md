---
name: pm-delegation-and-routing
description: "Code Owner directives on how this seat spends its own context - the main session is a router, and substantive work is delegated by model tier"
metadata:
  node_type: memory
  type: feedback
---

Three Code Owner directives from 2026-07-30 to 2026-08-01, one operating model. All three are summarized as single lines in `plan/CLAUDE.md`; the rationale and the boundaries below are what those lines compress, and they are the part that gets re-learned the expensive way.

## The main session is a router (2026-08-01, both seats)

This seat's main loop reads seat mail, watches PRs and monitors, decides, and relays. Any leg expected to exceed a few minutes - deep review passes, design authoring, gate or verify runs, captures, bulk exploration - is spawned as a **background** subagent, and the loop keeps ticking and acts on completions as they arrive.

**Why:** the seat-mail cadence is physically impossible from inside a long tool call. On 2026-08-01 the dev conductor ran the landing gates inline and went silent for 26 minutes with a steer sitting unread. The same failure shape applies here whenever a review or design pass runs synchronously.

**How to apply:** spawn substantive work so it runs in the background and reports back, rather than blocking the turn - in the current harness that is the Agent tool's `run_in_background` flag, defaulted on. Keep inline Bash calls short. When a background result is needed before proceeding, do the waiting by handling other events, not by blocking. The directive is the behaviour, not the flag name: if the harness renames or drops the knob, the rule still stands and the mechanism is whatever makes the main loop keep ticking.

**Companion practice (Code Owner, 2026-08-01): ask, don't just diagnose.** When the dev seat is silent past its cadence (~10 minutes), the first move is a "STATUS?" seat mail requesting a state report. Process forensics come second. A quiet seat gets asked; only an unresponsive one gets investigated.

## CSS and HTML design artifacts go to a Sonnet subagent (2026-07-30)

Producing or revising design artifacts (theme sheets, preview and component cards, showcase pages) is delegated to a subagent with `model: "sonnet"`, rather than authored inline.

**Why:** the Code Owner asked for it directly, after a session where all component-card authoring ran inline on the top-tier model. Markup production is high-volume mechanical output; this seat should hold review, token and WCAG gating, decisions, DesignSync publishing, and commits.

**How to apply:** hand the subagent the token sheet, the house constraints (tokens-only colours, no em dash, light/dark/HC switcher, `@dsCard` marker), and the exact deliverable. Review its output against the contrast build gate and screenshots before publishing.

**Boundary, and say it in every spawn prompt (2026-08-01):** the subagent authors and iterates artifacts only. It does not create worktrees, commit, push, or open PRs. One did all four unprompted on the `ds-navbar` reconcile; the work was clean, but review then happened after the PR existed instead of before.

## Ad-hoc dev work goes to the `dev-task` subagent on Opus 5 (2026-07-31)

Repro scripts, diagnostic probes, gate and tooling changes, proposed diffs, and spike branches this seat needs are spawned as the `dev-task` agent type (`.claude/agents/dev-task.md`, pinned `claude-opus-5`), never done inline.

**Why:** same shape as the Sonnet rule - match the model to the work and keep heavy implementation out of this session's context. The `protect-main` ruleset (PR plus green checks, squash only) makes "hand back a branch, seat merges" the only landing path anyway.

**How to apply:** spawn with `subagent_type: "dev-task"`, giving it the concrete goal, the repo paths involved, and which gates apply. Verify the agent definition still exists before relying on it. Numbered plan tasks stay in the dev loop - this agent refuses them by design.

Related: [[freeze-design-before-briefing-dev]], [[plan-against-official-docs]], [[qcms-pr-flow]].
