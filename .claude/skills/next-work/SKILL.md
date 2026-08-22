---
name: next-work
description: Single-seat QCMS work selector. It handles current PR findings first, resumes interrupted work, then selects an eligible numbered task or GitHub issue and delegates through the standard executor-reviewer-merge flow.
---

Run one single-seat work iteration. A count argument limits concurrent independent executors; review and merge remain serialized.

1. Stop and report if the shared checkout is dirty.
2. Inspect open task and issue PRs before selecting fresh work:
   - current-head `AGENT-REVIEW: CHANGES-REQUESTED` or unresolved comments are handled first;
   - a stale or missing review on an otherwise ready PR triggers `task-reviewer`;
   - current-head approval triggers final merge checks;
   - `HANDOFF: AWAITING-HUMAN` remains parked until its named action occurs.
3. Resume an interrupted `feat/*` or `fix/*` claim that has no live owner.
4. Otherwise select the next eligible numbered task using `next-task` rules. If none is executable, select the next eligible issue using `next-issue` rules.
5. Delegate implementation, gates, and independent exact-head review through the corresponding skill. Never perform long implementation or verification work inline in the conductor.
6. If one item parks on a human action, independent work may continue, but never cross its dependency or file seam and never hold more than three parked items.
7. End with exactly one line: `NEXT-WORK: LANDED task <NNN>`, `NEXT-WORK: LANDED issue #<NN>`, `NEXT-WORK: RESUMED task <NNN>`, `NEXT-WORK: RESUMED issue #<NN>`, `NEXT-WORK: AWAITING-HUMAN <reason>`, `NEXT-WORK: BLOCKED <reason>`, or `NEXT-WORK: NOTHING`.

Only `AWAITING-HUMAN`, `BLOCKED`, and `NOTHING` stop the supervisor. Never stop merely because a finding is interesting or a PR is waiting on work the conductor can perform.
