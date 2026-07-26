---
name: qcms-pr-flow
description: The two-seat PR-per-issue flow - who opens, who merges, sentinels, gates (adopted 2026-07-25)
metadata:
  type: project
---

The dev loop's /next-issue opens **one PR per issue** (never merges): body carries the acceptance checklist, `Fixes #NN`, a reviewer verdict, a `## Retro` section, and - for anything respondent-visible - gate screenshots committed under `docs/gates/pr-NN/` and embedded via raw branch URLs. This seat is the **merger** (procedure: `plan/pr-review-loop.md`): review as a stranger, sweep Copilot comments (fix or reasoned reply, sweep output READ before any merge command), verdict comments end with a head-bound sentinel (`PO-REVIEW: APPROVE|CHANGES-REQUESTED @<headRefOid>` - CHANGES-REQUESTED on the current head triggers the dev loop's findings cycle; stale SHA = merger owes a re-review), squash-merge keeping `Fixes #NN`, delete branch, append retro to `docs/RETRO.md`, flip any ledger row. Human gates park the PR, never the run; the loop ends only on NOTHING or a stated repo-wide blocker, and re-arms before summarizing. Same-account PRs cannot carry GitHub review states - the sentinel is the machine signal. Idle ticks do docs/non-functional work (step 6). See [[qcms-project-state]].
