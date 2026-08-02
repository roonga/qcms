# Workshop queue - items for the next `/improve-workshop` pass

`/improve-workshop` is human-triggered and runs at stage boundaries, never mid-loop (CLAUDE.md). Findings that surface between boundaries land here so they are not lost or, worse, fixed mid-loop by whoever noticed them.

One entry per finding: what is wrong, the evidence, and what the edit would be. This file is a queue, not a decision record - the workshop pass decides.

---

## The root CLAUDE.md tells UI tasks to use MCP browsers this repo does not use

**Raised:** 2026-08-02, PM seat, during a container setup audit while 034 was in flight.
**Status:** queued for the next boundary. Deliberately not fixed mid-loop; the dev seat declined to fold it into 034, correctly.

**What is wrong.** `CLAUDE.md` lines 54-59 (the token-efficiency section) instruct UI tasks (028-035, 030, 042) to budget context for "Browser / Chrome-DevTools MCP / Playwright", DOM snapshots, accessibility trees, console and network dumps, and to "Load only the MCP tools the task needs (one batched ToolSearch)". None of that describes how this repo captures gate evidence or runs axe.

**Evidence (verified 2026-08-02, both seats independently).**

- No MCP server is configured in any scope, and no plugin is enabled - the container holds only the cloned official marketplace catalogue.
- Gate capture is Playwright-direct: `apps/admin/e2e/gate-screenshots{,-032,-033}.pw.ts` and `apps/portal/e2e/gate-screenshots.pw.ts`, sharing `apps/admin/e2e/support/capture.ts` (`CAPTURE_ENABLED`, `CAPTURE_MODES`, `captureInto`), writing PNGs straight into the committed `docs/gates/<NNN>/`. Each is skipped unless `QCMS_ADMIN_CAPTURE_GATE=1` so a standing `verify:browser` never dirties the tree.
- Axe is the same: `apps/admin/e2e/a11y-axe.pw.ts`, helpers in `e2e/support/`.
- `grep -rniE "chrome-devtools|mcp__|playwright.*mcp"` over `apps/admin/e2e`, `apps/portal/e2e` and `scripts` returns nothing.
- The Playwright path has produced committed gate evidence at least five times: `docs/gates/` holds 031, 032, 033, 053, 055 plus the `pr-*` issue gates. 033's set is 24 PNGs, exactly the four states x two viewports x three modes its spec emits.

**Contributing cause.** `.claude/settings.json` still carries allow rules for `mcp__plugin_playwright_playwright__*` and `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`. They match nothing and are harmless, but they are why the instruction still reads as live.

**Candidate edit** (the workshop pass decides, not this file). Rewrite the token-efficiency bullets so the context-discipline advice - filter at the source, screenshots to files referenced by path, finish the interaction once verified - attaches to the Playwright/gate-capture path this repo actually uses, and name `QCMS_ADMIN_CAPTURE_GATE=1` with the spec-per-task convention. Decide separately whether the two dead allow rules come out or an MCP browser is actually wanted; if neither is wanted, removing them keeps the instruction from re-growing.

**Why it matters beyond tidiness.** A UI task's executor reading CLAUDE.md today is told to reach for a tool that is not installed. It would fail fast rather than silently, but at the cost of a live cycle - and the instruction is most likely to be read at exactly the moment a screenshot gate is due.
