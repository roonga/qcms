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

---

## Executors report fixes they have not verified against their own tree

**Raised:** 2026-08-02, from 034's second review cycle.
**Status:** queued as an executor-instruction change. The 034 instance is being fixed in cycle 2.

**What happened.** 034's fix report listed two resolutions that did not exist in the branch: the mint dialog's hint was reported as reading "end of this day, UTC" while the catalog string was unchanged (a grep for "UTC" across the whole admin catalog returned nothing), and a "secure links table with a revoked link" axe state was reported as added while the sweep still ended at "revoke confirmation". Both were confirmed absent by the conductor independently before the cycle was dispatched.

**The worse half.** Two source comments asserted the missing copy as fact - `actions.ts` claiming "The zone is UTC and the dialog's hint says so", and a matching note in `format.ts`. A resolution claimed but absent costs one review cycle and is then over. A comment describing copy a sibling file is *supposed* to contain outlives the cycle and makes the next reader confident about something untrue - so the cheapest defect becomes the longest-lived one.

**Why it matters more than a slow cycle.** The only thing standing between this and a bad outcome was that the reviewer reads the tree rather than the report. Had the report been trusted, the Code Owner would have been asked to sign a gate whose evidence contradicted the copy the PR claimed to have. That is the same lesson as holding a screenshot gate until its PR exists: the artifact is the truth, the summary is a claim about it.

**Candidate edit.** Two lines in the task-executor instructions. First: before reporting a fix round complete, grep the diff for each claimed resolution and quote the evidence - a report is a claim about the tree and has to be checked against it. Second: never write a comment describing content another file is supposed to contain; if the comment is only true once a sibling lands, it is not yet true. Consider whether the reviewer's re-verification should be stated as load-bearing in the flow docs, since it is currently the only mechanism that catches this and is not described as serving that purpose.

---

## The review sweep misses the surface where line-anchored findings live, and skips entirely on a re-review

**Raised:** 2026-08-02, from PR #274 (task 034). Both seats failed the same way on the same PR.
**Status:** queued. This is a process defect with two distinct halves, and neither is a doc typo.

**What happened.** GitHub's automated reviewer posted three line-anchored threads on #274. Two were real bugs: a blob URL revoked synchronously after `anchor.click()`, giving intermittently empty or truncated CSV exports in browsers that lose that race, and `fail.previewRejected([])` raising an error whose admin copy promises "The reasons are listed below" with nothing to list. Neither review read them.

**Half one - the sweep skipped on a re-review.** The timeline is exact:

```
06:13:25Z  PO-REVIEW: CHANGES-REQUESTED @b332c442   (PO seat)
06:14:35Z  thread: secure-links.tsx
06:14:35Z  thread: version-view.tsx
06:14:36Z  thread: handler.ts
06:15:41Z  PO-REVIEW: APPROVE @14eb0f5c             (PO seat)
```

The threads were visible for 66 seconds before the approval. The PO seat had scoped the re-review to the one-line ledger diff and said so explicitly - "the re-review is that one line, not a fresh pass" - and ran no sweep. `plan/pr-review-loop.md` requires the sweep as its own step whose output is read before any merge command; on a task PR the sentinel *is* the merge authorization, so the requirement binds at least as hard there.

The tempting reasoning is that a one-line diff cannot have new findings. That is true of the diff and false of the PR: the comment surface moves independently of the tree.

**Half two - nothing polls threads at all.** The conductor found those threads at 07:45 by chance, while checking whether the gate had been signed, not because any step directed it to. Its poll loop reads issue comments for the PO sentinel. Issue comments and review comments are **different API surfaces**: `gh api repos/<o>/<r>/issues/<n>/comments` versus `gh api repos/<o>/<r>/pulls/<n>/comments`. A comments-only poll is structurally blind to the half where line-anchored findings live, which is where both of this PR's real late-stage bugs were.

So the process failed twice, from two seats, on one PR, and was rescued by unrelated curiosity.

**Candidate edit.**

1. State in `plan/pr-review-loop.md` that the sweep runs on **every sentinel-bearing review, including a re-review of a one-line diff**, and that it covers both surfaces explicitly - naming both commands, because "read the comments" does not disambiguate them.
2. Give the dev loop's poll the same treatment wherever it reads for a sentinel.
3. Consider whether a stale-sentinel rule should be mechanical: a sentinel whose head no longer matches is already treated as stale, but a sentinel emitted *before* an unread thread has no such marker.

---

## Every gate-frame claim also needs a DOM assertion

**Raised:** 2026-08-02, task 034. Recorded on main in `docs/RETRO.md` under `## 034`; this entry exists so the boundary pass finds it in the queue it works from.

**Source, quotable verbatim from the retro:**

> a fix visible only in a committed gate frame has no automated check behind it. 034's ADR-27 violation was found by a reviewer reading PNGs, and a cycle-1 resolution that was claimed but never landed was invisible for the same reason. The general fix is that every gate-frame claim also gets a DOM assertion: cycle 2's `expect(dialog).toContainText("UTC")` asserts the string reaches a rendered operator dialog rather than merely existing in the catalog, and is exactly the check that would have caught the miss. Screenshots are evidence for a human gate, not a substitute for an assertion.

**Why it belongs in the queue and not only in the retro.** The retro records what happened on one task; the queue is what the boundary pass edits instructions from. This one has a concrete candidate edit: when a task's exit criteria include a screenshot gate, the same properties the frames are meant to show should be asserted in the browser suite, so a regression fails a test rather than waiting for a human to notice it in a PNG. 034 demonstrates both directions - the ADR-27 violation was caught by a human reading frames, and the missing UTC hint was caught only after a DOM assertion existed for it.

**Related.** This is the same lesson as the copy-from-intent pattern in the same retro, seen from the evidence side: the screenshot shows what the system did once, the assertion states what it must always do.
