---
name: freeze-design-before-briefing-dev
description: "Never relay in-flux design iterations to the dev seat - one pause heads-up, then a single frozen brief"
metadata:
  node_type: memory
  type: feedback
---

While a design is actively iterating with the Code Owner, the dev seat gets ONE immediate heads-up ("design in flux - pause work on `<area>`, keep everything else moving") and then nothing until a single FROZEN brief. Never relay each iteration as it happens.

**Why:** on 2026-07-31 three superseded topbar briefs reached the dev loop mid-session, two of them after its executor had already written code against them. Only an uncommitted tree kept that from being a revert on a pushed branch. The executor's FRICTION line named this seat's relaying as the cause, and it was right (recorded in the 032 retro).

**How to apply:** when the Code Owner starts iterating on a design that dev work builds against, send the pause mail first, batch every refinement into the design artifact, and send exactly one brief when the Code Owner says go. The card or artifact is the contract; briefs only point at it.

**Related trap, same night:** the design agents iterated `ds-navbar.html` directly in the shared checkout while PRs were being committed from worktree copies, leaving the shared tree dirty for the dev conductor to trip over. Design artifacts get iterated in a worktree or the scratchpad, never the shared checkout - only the PR lands them.

Related: [[pm-delegation-and-routing]], [[qcms-design-system]].
