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

---

## Raw API timestamps reach JSX, and it is now a recurring admin-train pattern

**Raised:** 2026-08-02 by 034's reviewer (REJECT finding), seconded by the PM seat.
**Status:** the 034 instance is being fixed in its own PR. Queued here is the *pattern*, not that fix.

**What is wrong.** ADR-27 requires locale-aware presentation, but API ISO strings keep reaching the DOM verbatim in operator tables. 034 shipped four such columns (`version-history.tsx` Published; `secure-links.tsx` expiresAt, consumedAt, createdAt) and it was visible in the committed gate frames: `version-history-light-1280.png` showed `2026-07-20T00:00:00.000Z`, `links-minted-*` showed `2030-12-31T23:59:59.999Z`.

**Why it is a pattern and not an incident.** 032 avoided it only by dropping its "Updated" column for unrelated reasons - the trap was there and was sidestepped by accident. Two consecutive admin tasks, no mechanical guard. Every new operator table is another chance.

**Candidate edit.** A gate is the natural fix: nothing in `check:all` looks for an ISO-shaped string rendered as a JSX child. A check in the shape of `scripts/check-admin-theme.mjs` (scan `apps/admin` sources, flag a datetime-typed field interpolated directly into JSX) would make this mechanical instead of a review catch. Consider also a line in `docs/COMPONENT_GUIDELINES.md` or `CLAUDE.md` naming the shared formatter as the only way to render a timestamp, with the CSV exception stated (machine artifacts keep ISO - localizing those would be the actual bug).

**Note for whoever picks this up.** The gate frames are what made it visible. That is an argument for the screenshot gate being reviewed in the PR, where the images are actually looked at, rather than signed from a branch listing.

---

## The i18n catalog has no plural machinery, so `{count}` keys produce "1 links"

**Raised:** 2026-08-02 by 034's reviewer.
**Status:** the specific broken strings are fixed in 034's PR. The absence of the machinery is queued here.

**What is wrong.** `t()` has no plural forms. Keys that interpolate a count therefore emit "1 steps", "1 rules", "1 links minted" whenever the count is one. Worse, e2e assertions written against the rendered output then *enshrine* the broken string, so the bug acquires a test defending it.

**Why it matters beyond grammar.** ADR-27 commits the product to internationalization. Plural rules are not a polish item in that commitment - languages with more than two plural categories cannot be served by string concatenation at all, so the absence is architectural rather than cosmetic. Fixing it after several locales exist is materially harder than fixing it now, while English is the only catalog.

**Candidate edit.** Decide the plural mechanism for the catalog (`Intl.PluralRules` is in the platform and needs no dependency), then sweep existing `{count}` keys. The sweep must also revisit any e2e assertion that currently encodes a singular-broken string, or the fix will fail tests that are asserting the bug.

---

## The wireframe's normative history multi-version and diff state has no visual evidence

**Raised:** 2026-08-02 by 034's reviewer.
**Status:** queued. Not a 034 blocker - the diff is unit tested and the state is reachable.

**What is wrong.** `docs/wireframes/` inventories are normative (per CLAUDE.md), and the admin publish/preview wireframe carries a "history multi-version + diff" state. 034's evidence covers it by unit test only: no browser assertion, no gate frame. So a normative state has no evidence in the form the gate reviews.

**Candidate question for the workshop pass.** This is really about whether "normative wireframe state" implies "must appear in the gate set". If it does, that belongs written down, because it changes how every future UI task sizes its capture matrix. If it does not, the wireframe inventories need a way to mark which states are gate-bearing, so the distinction is visible rather than a judgement call made per task.

---

## A screenshot gate signed before its PR exists is signed against a state the work will not land in

**Raised:** 2026-08-02, both seats, from 034's concrete near-miss.
**Status:** queued. This is a rule the workshop pass should consider writing down, not a bug.

**What is missing.** CLAUDE.md already says a screenshot gate's evidence is committed in the diff rather than shown in the session, that it lives under `docs/gates/<NNN>/` with a README naming what to approve, and that the Code Owner reviews from GitHub. What it does not say is **when**: nothing currently rules out signing from a branch tree listing before the PR exists.

**Why the timing is load-bearing and not a formality.** The PR is what embeds the images by raw branch URL, and it is also the point at which the work has passed review. A gate signed earlier is signed against evidence that has not been through the reviewer, so it can be signed against frames the fix round is about to replace - which makes the signature a statement about a state the repo will never contain.

**The concrete instance.** On 2026-08-02 the Code Owner declined to sign 034's gate because no PR existed yet and the 60 PNGs were only reachable as a branch tree listing. The reviewer then returned REJECT on ADR-27: raw API ISO strings rendered in two operator tables, visible in those very frames (`version-history-light-1280.png` showing `2026-07-20T00:00:00.000Z`, `links-minted-*` showing `2030-12-31T23:59:59.999Z`). Had the gate been signed when the evidence first existed, the Code Owner would have approved frames that are now being recaptured.

**Candidate edit.** Add the ordering to the human-gates bullet: a screenshot gate is presented for signature **after** the reviewer's verdict and **in the PR**, never from a branch listing. Note the corollary for conductors: an early tree URL may be offered as an optional look, but it is not the gate, and it should be labelled that way when offered (which is what happened here).

**Related.** Two of the three findings above were caught by looking at gate frames, which is the same argument from the other direction: the frames are evidence, so they have to be reviewed where they are actually looked at.
