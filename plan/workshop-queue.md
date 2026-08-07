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

**Half one - the sweep skipped on a re-review.** The timeline is exact (SHAs abbreviated here for reading; a real sentinel carries the **full** `headRefOid`, and a truncated one binds to nothing):

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

---

## A gate reached standalone behaves differently from the same gate inside `verify`, and the cheap-iteration path is the one that lies

**Raised:** 2026-08-06, both seats, during the Actions outage (#316 / PR #334 and the retrospective verification of `main`).
**Status:** queued. Two independent instances in one session, which is what promotes it from anecdote to rule.

**What is wrong.** `CLAUDE.md` tells an executor to run the cheap gates first on new files (`pnpm --filter <pkg> lint` before anything else) and separately warns about turbo's cache. Both are good advice. Neither says the general thing: **the standalone invocation of a gate and the same gate inside `verify` do not observe the same inputs**, so a standalone green is not evidence.

**Evidence, two instances.**

1. **`check:ports` only sees tracked files.** #334's executor ran it standalone against its new `scripts/loopback-forward.mjs` and its test, got OK, and reasonably believed the gate satisfied. It went red the moment the files were committed, because the gate walks git-tracked content. Cost: a full `verify` cycle, and a REJECT verdict from the dev seat's reviewer that was purely mechanical. The repo's own guidance actively steered into this, since "run the cheap gates first on new files" is exactly wrong for any git-driven gate.
2. **Turbo reports `FULL TURBO` for a test phase that did not run.** Already in `CLAUDE.md`, but seen twice more this session: the dev seat's `verify` on the #316 branch reported `14 cached, FULL TURBO`, and the retrospective verification of `main` reported `14/14 cached` on every phase. In both cases the forced run (`turbo run test --force`, `0 cached`) was the only evidence tests executed.

**Why the pair matters more than either.** One is a git-visibility artifact and the other a cache artifact, but the executor-facing shape is identical: *the cheap way to check produces a green that the expensive way does not honour.* An executor that learns only the turbo case will be caught by the next instance of the general case.

**Candidate edit.** One line in `CLAUDE.md`'s toolchain rules naming the general shape, with both instances as examples, and a correction to the "run the cheap gates first on new files" advice: for any git-driven gate (`check:ports`, `check:changeset`, `check:golden-append-only`, `check:no-em-dash`), **commit first, then run it** - or the gate is reading a tree that does not include the work.

**Related.** The `check:changeset` / `check:golden-append-only` diff-basis note in `plan/ci-outage-protocol.md` is the third member of this family: both diff against `origin/main`, so on a push to `main` they assert nothing at all.

---

## Reporting discipline between conductor and executor: say when you touch a live tree, and quote from output taken at report time

**Raised:** 2026-08-06, dev seat, self-reported during #316 / PR #334. Both halves are the seats' own findings; recorded here because they are instruction edits, not task facts.

**What happened.** The conductor rebased an executor's worktree **while that executor was still live**, and did not tell it. Root cause was a stale shell working directory read as a deleted worktree, which made a false alarm look like uncommitted work at risk. Nothing was lost and the rebase was clean. But the executor noticed only because an empty `HEAD..origin/main` looked wrong and it chased the reflog instead of accepting the reading - had it trusted the first look, it would have reported "already up to date" for a rebase it never ran and could not vouch for.

Separately and in the same session, the same executor reported "working tree clean" from memory when it was not; the conductor caught real uncommitted work (a `pathToFileURL` guard fix plus 38 lines of test) only because it checks the tree before rebasing rather than trusting the claim.

**Candidate edits, two.**

1. **If the conductor operates on a live agent's worktree, it says so in the same message.** Cheap, and it removes a whole class of confidently-wrong reports, because the agent then knows to re-read rather than trust its cached view.
2. **Anything the conductor will act on without re-verifying must be quoted from output taken at report time**, not stated from memory of having run the command. Head SHAs above all: reviews, sentinels and dispatched checks all bind to them, so a remembered SHA is a stale gate. This is the stronger half and the executor adopted it voluntarily.

**Supporting practice worth naming in the same edit.** The same executor proved its new test by restoring the bug it was written for (the old `file://${process.argv[1]}` interpolation) and watching the test go red, then green again. Its own worktree path contained no percent-encoding character, so without that step it would have shipped a test that passed for the wrong reason. "Prove the test fails without the fix" is the general form.

---

## A docs-heavy change must sweep every doc describing the behaviour it changes, not the ones it happens to be editing

**Raised:** 2026-08-06, PM seat, in the pre-merge review of PR #334.

**What happened.** PR #334 changed how the full-stack harness is invoked from the dev container. It correctly updated `CONTRIBUTING.md`, `CLAUDE.md` and `docs/PORTS.md` to steer at `QCMS_PORT_SEAT=<n> pnpm up:e2e`. It missed `README.md:79-93`, which still presented the split `docker:up` / `test:e2e` / `docker:down` flow as the primary way to run the browser end-to-end suite.

**Why it is worse than an ordinary staleness miss.** That flow now **blocks the terminal** inside the dev container (the forwarder is spawned with ref'd stdio and no `unref`, so parent and child each wait for the other), and a reader who Ctrl-Cs out gets `ECONNREFUSED` on the next step - which is precisely the #316 symptom the PR exists to remove. A README that reproduces the bug is the worst possible artifact of the PR that fixes it. The same PR also left a source comment (`scripts/compose-e2e.mjs:469-471`) describing a state that is now unreachable.

**Contributing cause.** The staleness rule in `CLAUDE.md` says "a doc contradicted by a newer decision is fixed in the same change", which is right, but nothing turns it into an action. Three docs got updated because they were already open; the fourth was not, so nobody looked.

**Candidate edit.** Make the staleness rule operational for behaviour changes: when a change alters how a documented command is invoked, grep the repo for that command string (`docker:up`, `up:e2e`, `verify:browser`, and so on) and fix every hit in the same PR. That is a mechanical sweep, it takes seconds, and it would have caught this one. It is the doc-side twin of the executor's own FRICTION line from the same PR: *"when a change alters an origin or address, grep every consumer of that value, not just the dialler."*

**Note.** The PM seat's own `plan/ci-outage-protocol.md` carried the identical error and was corrected in the same wrap-up. The rule applies to this seat too.

---

## The `timestamptz` note in CLAUDE.md is right about one client and silent about the other, so it is trusted and wrong

**Raised:** 2026-08-07, dev seat, during task 059. Both seats rank this the most urgent item in the queue.

**What is wrong.** `CLAUDE.md` line 38 (the DB/integration-tests bullet) says:

> raw `` sql`` `` reads return timestamptz as a **string** (query builder `mode:"date"` returns a Date) - normalize

That is true of drizzle's raw template. It is **false** of `testDb.client.query`, which is a `pg` client whose default type parser returns a `Date` for timestamptz. The note names neither client, so a reader applies it to whichever one they are holding.

**What it cost.** 059's executor wrote a wrong type annotation and a wrong explanatory comment on the strength of this note, and was corrected only by a failing assertion. The cost is small in isolation; the shape is not.

**Why this is worse than having no note.** A missing rule makes an executor check. A rule that is confidently right about one case and silent about a neighbouring one makes an executor *not* check, and it is trusted precisely because it is specific and correct-sounding. This is the second time this session a documented rule steered into the failure it was meant to prevent - the other being "run the cheap gates first on new files", which is wrong for every git-driven gate. The two belong to one family and could be fixed in one pass.

**Candidate edit.** Name the client in the clause. Something of the shape: *drizzle's raw `` sql`` `` template returns timestamptz as a string, the query builder with `mode:"date"` returns a Date, and `testDb.client.query` (a `pg` client) returns a Date by default - so check which of the three you are holding before normalizing.* The general principle is worth stating once somewhere too: **a trap note that covers one of several adjacent APIs must say which, or it will be read as covering all of them.**

---

## An API route-schema change requires `pnpm openapi:generate`, and nothing says so

**Raised:** 2026-08-07, dev seat, during task 059.

**What is wrong.** Neither the task file nor `CLAUDE.md` mentions that changing an API route schema requires regenerating the OpenAPI document. 059's executor found out when `openapi-document.test.ts` failed inside its first full test run - a 90-second cycle to discover a one-command step.

**Why it belongs here.** This is the same family as the existing note that *"adding a `@qcms/db` query helper is a 3-place edit: `queries/<area>.ts`, the `queries/index.ts` re-export list, and the `import-surface.test.ts` allowlist"*. That note exists because the edit is non-local and the failure is a test that names none of the missing places. The OpenAPI case has exactly that shape: the change is in a route schema, the failure is in a document test, and the fix is a generator nobody told you to run.

**Candidate edit.** Add it beside the 3-place-edit note in `CLAUDE.md`'s toolchain rules: an API route-schema change is a 2-place edit, the schema and `pnpm openapi:generate`, and `openapi-document.test.ts` is what catches you.

---

## A task that closes a known gap should name the tests written to accommodate that gap as expected collateral

**Raised:** 2026-08-07, dev seat, during task 059.

**What happened.** Task 035 had shipped roughly 180 lines of machinery in `apps/admin/e2e/responses-ops.pw.ts` built specifically to work around the pre-059 behaviour - because at the time, an erased session's outbox payload genuinely still carried its answers and the spec had to accommodate that. 059 closed the gap, and all of that machinery became dead or actively false in one step. Reworking it was **the single largest chunk of 059**, and nothing in the task file anticipated it.

**Why it is a workshop item rather than a task fact.** The estimate and the exit criteria both described the production change; the largest piece of actual work was in a test file neither mentioned. That is a systematic blind spot, not a one-off: whenever a task closes a gap that an earlier task had to code around, the earlier task's accommodations are guaranteed collateral, and they are invisible to anyone reading only the new task file.

**Candidate edit.** When a task file's job is to close a known gap (they are usually identifiable - they cite an ADR amendment, a stopgap, or an issue describing behaviour as temporary), it should carry a line naming the specs and helpers written to accommodate that gap, as expected collateral. Cheap to write when the task is drafted - the drafting seat generally knows which stopgap it is retiring - and it sets the scope honestly for whoever executes it.

**Related.** 035's copy was itself described as a truthful stopgap for exactly this gap, so in this instance the pointer existed in prose and simply was not carried into 059's task file.

---

## "X is excluded from the list, so the X handler is unreachable" is unsound wherever a human acts on a page served earlier

**Raised:** 2026-08-07, PM seat, correcting its own ruling during task 059. The dev seat asked for it to be queued in its own right rather than folded into the reviewer-split item, and it is right that it generalises.

**What happened.** 059 left the admin's `DELIVERY_SESSION_ERASED` message path in place while making cancelled rows excluded from the dead-letter queue. Asked whether the now-apparently-dead code should be removed, this seat ruled: keep it, and document it as **unreachable from the dead-letter queue by design**.

The premise was wrong. The reviewer showed the path is **race-reachable**: the dead-letter queue renders, erasure commits, the operator then clicks Redeliver - or "Redeliver all" iterates ids it already displayed - and the API answers 409, which the admin must render as a copy string rather than an internal error. The bulk summary's refused variant at `en.ts:1122` already existed for exactly that race, so the codebase had encoded the answer before anyone asked the question.

**The reasoning error, stated generally.** The ruling reasoned from the **query** (cancelled rows are excluded from the list, therefore the handler that serves them is dead) and forgot that a rendered page is a **snapshot, not a live view**. Any argument of the form *"X no longer appears in the list, so the code path that handles X is unreachable"* is unsound in any system where a human acts on a page they were served earlier. It is the same shape as every TOCTOU bug, and it is specifically the reasoning that makes correct defensive code look deletable.

**Why it is worth an instruction and not just a note.** The failure mode is asymmetric. Applied to a privacy or security control, it deletes a guard that fires only under a race - which is exactly the case that is hardest to test, hardest to notice missing, and worst to be wrong about. And the argument is persuasive: it cites a real query and reaches a confident conclusion.

**Candidate edit.** Where the toolchain rules already say to grep every "sole/only door/path" comment for staleness when a guard changes, add the converse: **before deleting a handler as unreachable, ask whether a user could act on a view rendered before the state changed.** If yes, it is race-reachable, and the comment says *when* it is reachable rather than claiming it is dead. A comment claiming a live path is dead is worse than no comment, because it invites the deletion.

**Postscript worth keeping.** The conclusion (keep the code) survived the wrong premise, and the reason originally given for keeping it - that a dead-code claim invites a future cleanup to delete it - argued *harder* for keeping once the premise was corrected. That is unusual enough to note: a right answer reached by a wrong route is still a wrong route, and the route is what gets reused.

---

## Reviewer and conductor both ran the gates, so the reviewer stalled on runs it did not own

**Raised:** 2026-08-07, dev seat's reviewer, during task 059.

**What is wrong.** The `task-reviewer` charter tells the reviewer to run the gates itself. On 059 the conductor had already dispatched CI against the same head and told the reviewer not to. The reviewer stalled waiting on runs it neither owned nor could see the completion of, and returned without a verdict until the conductor told it explicitly that CI was the conductor's.

**The split that emerged, and worked.** **Reviewer owns static verification** - reading the diff, checking exit criteria, tracing invariants, running targeted unit tests. **Conductor owns the CI it dispatched**, and reports the result to the reviewer rather than the reviewer chasing it. That kept one set of Docker suites running instead of two competing for the same machine, which matters more now that seat contention is a known false-red source.

**Candidate edit.** Write the split into the reviewer instruction, in both directions: a reviewer should not double-run Docker or browser suites against a head where CI is already live, **and** should not block on runs it does not own - if it needs a gate result it does not have, it says so and returns its static verdict rather than waiting. The conductor's half is to state, when dispatching a reviewer, whether CI is already running on that head.

---

## "Every clause has an assertion behind it" cannot be read literally for docs that describe non-behaviours

**Raised:** 2026-08-07, dev seat's reviewer, during task 059.

**What is wrong.** 059's exit criterion 5 required that every clause of the changed operator documentation have behaviour asserted behind it - the copy-from-intent rule, which is a good rule and caught real defects on 034. But part of what an erasure guide must document is what the system **does not** do: the in-flight delivery window, backups aging out on their own schedule, a consumer's independent copy. Those have no behaviour to assert, by construction.

The reviewer had to silently reinterpret the criterion as "every **behavioural** claim has an assertion" in order to pass the task at all.

**Why that is a problem even though it worked.** A rule that requires silent reinterpretation is a rule that will eventually be applied literally by someone stricter, and the outcome then is either a task blocked on an impossible criterion or a doc padded with assertions that assert nothing. The reinterpretation should be in the rule, not in the reviewer.

**Candidate edit.** State the rule as "every behavioural claim in changed copy has an assertion behind it", and add the corollary that a documented **non-behaviour** - a limit, an out-of-scope actor, a window the system does not control - is exempt but should say plainly that it is a limit rather than a promise. That second half is the part that keeps the exemption from becoming a hole.

---

## A green signal whose scope you did not verify is not evidence (six instances in one session)

**Raised:** 2026-08-07, both seats, synthesising findings from #316/#334, 059, 036 and the CI-outage work of the same night. The compact framing is the dev seat's.

**Why this entry exists.** Several queue entries above describe individual traps. Within a single session, six of them turned out to be the same trap, arriving from six unrelated directions. At that point it stops being a list of gotchas and becomes a principle worth stating once, because the next instance will not resemble any of these six either.

### The six

1. **`check:ports` on new files.** Run standalone against uncommitted work it returns OK, because it walks git-tracked content. It went red the moment the files were committed. Cost #334 a full `verify` cycle and a mechanical REJECT. Our own guidance ("run the cheap gates first on new files") steers directly into it.
2. **Turbo's `FULL TURBO`.** A `verify` in a fresh worktree routinely reports the whole test phase as `14/14 cached` because turbo resolves to the main checkout's cache. Seen three times in one night. Only `turbo run test --force` reporting `0 cached` is evidence that tests executed.
3. **`Object.keys()` on a `Map`.** 036's env-reference scan enumerated zero entries and cheerfully reported "no mismatches". Caught only because the executor added a deliberate `expect(size).toBeGreaterThan(10)` guard - which then exposed a real classification bug underneath.
4. **`gh pr checks <n>` on dispatched runs.** Reports "no checks reported on the branch" while the runs are green and correctly bound to the head SHA. The information is real and the query looks at the wrong surface; `gh api repos/<o>/<r>/commits/<sha>/check-runs` shows them.
5. **`check:changeset` and `check:golden-append-only` on a push to `main`.** Both diff against `origin/main`, so on `main` itself the diff basis is the commit under test. They pass, and they assert nothing whatsoever.
6. **A deleted guard.** 058 must relax `renderer-surface.test.ts`'s negative assertions to do anything at all. If it deletes them rather than inverting them, the guard silently becomes a check that looks at nothing - and the suite stays green while the property it protected is gone.

### The shape

The common failure is **not** "tests can be wrong". Every one of these signals was *correct about what it examined*. The failure is that **the scope of what was examined was assumed rather than checked** - tracked files vs all files, executed vs cached, a `Map` vs an object, one API surface vs another, a diff basis that is empty by construction, a guard that no longer runs.

So the principle: **a green signal whose scope you did not verify is not evidence.** It is a green signal.

### What follows from it, practically

Three habits, all cheap, each of which would have caught several of the six:

- **Prefer checks that state their own coverage**, and read the number. `0 cached, 14 total`. `18 passed`. `Map.size > 10`. A check that can only say "OK" cannot distinguish "looked and found nothing wrong" from "looked at nothing".
- **When a check disagrees with your expectation, suspect its scope before its verdict.** Four of the six were found this way - somebody noticed a count that was too round, an elapsed time that was too short, or a report that was too confident.
- **When relaxing a guard, invert it - never delete it.** If the property changes, assert the new property. A deleted assertion and a passing assertion are indistinguishable in CI output.

**Candidate edit.** State the principle once in `CLAUDE.md`, with two or three of the instances as illustration, rather than continuing to accumulate individual trap notes that each teach one case. The existing per-instance notes (the turbo cache trap, the git-driven-gate correction, the standalone-versus-`verify` entry above) then become examples of a stated rule rather than a list to memorise - which matters, because the value is in recognising the seventh instance, and it will not look like any of these six.

**Related.** This subsumes the "gate reached standalone behaves differently from the same gate inside `verify`" entry above, which is instance 1 and 2 seen from one angle. Keep both: that one has a specific candidate edit about git-driven gates, this one is the general rule.
