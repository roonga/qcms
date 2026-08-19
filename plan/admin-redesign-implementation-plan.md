# Admin screens redesign: implementation plan

**Status:** draft, PM/PO seat, 2026-08-19. **Builds on, does not duplicate:**
`plan/admin-ux-audit.md` (the sequence in its §8 is the backbone of this plan) and
`plan/admin-mobile-stance.md` (Code Owner decision, 2026-08-18, governs breakpoints
and the narrow-viewport bar). Read those two first; this document only covers what a
same-day design-POC session added on top of them, and where that session's output
disagrees with what those two documents already settled.

Nothing in `plan/admin-shell-poc/*.html` is shipped code. It is proposals.

**Current status: dispatched (updated 2026-08-19).** An earlier draft of this
paragraph recorded a scope freeze from a prior session: no writes outside `plan/`,
no `git` writes, no `gh` writes creating anything public. **That freeze has been
lifted by direct Code Owner instruction** in the session of 2026-08-19, which
asked for the plan to be reviewed and fixed, the mis-scoped compose change split
out and merged, and the redesign driven. Acted on since, and now part of the real
record: twelve issues filed and tiered (§3a), the eight Wave 3 contracts drafted
(`plan/admin-design-contracts.md`), and this branch's out-of-scope compose change
extracted to its own PR.

**One element of the freeze survives on its own merits, not the freeze's:**
ADR-39 stays a draft and is never promoted into `docs/PROJECT_GOAL.md` without an
explicit Code Owner decision. R1 protects immutability, one of the three
non-negotiables; amending it is not this seat's call, and that was true before
the freeze and remains true after it.

**Decision status: recorded in-session, attribution not independently confirmed
by this seat. Treat as pending Code Owner confirmation.**

- **C1 - Settings rail: keep it.** Overrides the audit's row-16 reject; see §2 for
  the recorded reasoning either way - and note that reasoning is thin (the override
  was never given a stated cause).
- **C2 - answer-preview column: build it.** Confirmed front-end-only (the data
  already flows end to end) - filed as
  [#515](https://github.com/roonga/qcms/issues/515).
- **N1/C3 - public form link: version-pinned, not a standing link.** No mechanism
  in QCMS supports this today. Full mechanism, R1 amendment, and a per-version
  open/redirect/closed lifecycle refinement are drafted in
  `plan/adr-39-version-pinned-links-proposal.md` - **a proposal, not promoted**,
  for the R1 reason stated above.

---

## 1. What this session found that the audit didn't cover

The audit (`plan/admin-ux-audit.md`) is exhaustive about the sixteen shipped screens
as they exist today. It does not cover two things a POC pass surfaced:

### N1. No public/published form URL exists anywhere in `apps/admin`

The portal serves anonymous, open access to a published form at `/f/{slug}`
(`apps/portal/app/f/[formSlug]/page.tsx`), keyed on the form's slug and composed
against `QCMS_PORTAL_BASE_URL` (`apps/portal/lib/server/config.ts:36-40`). An
operator has no way to see or copy that URL anywhere in admin today - the only
link-shaped thing in the app is a minted, one-time secure link
(`components/forms/secure-links.tsx`), which is a different mechanism for a
different purpose (an invitation, not the form's own standing address).

This is additive to the audit, not a disagreement with it: it is a missing
**capability**, not a layout question, so it does not slot into any of the seven
design-language elements.

**Recorded in-session as resolved (attributed to the Code Owner, 2026-08-19;
attribution not independently confirmed by this seat - treat as pending
confirmation, per the preamble): Form builder screen, one link per version,
shown after each publish.** This turned out to be a bigger decision than "where does
a link live" - the request was for a link *per version*, and nothing in QCMS today
lets a new session start on anything but the newest published version (confirmed:
every session-creation path, anonymous and secure-link alike, calls
`getLatestPublishedVersion`). That is a new engine capability, not an admin-UI
placement choice. Mechanism proposed in `plan/adr-39-version-pinned-links-proposal.md`:
a deterministic `/f/{slug}/v{version}` path (no minted token, no expiry - the version
is either published or it isn't, so there is nothing to mint), plus the R1 amendment
it requires. That document is the live one for this item; treat what follows here as
superseded by it.

### N2. A rail can visually stop short of the viewport on a short screen

Layout detail, not a design question. When a rail-bearing screen's main content is
shorter than the viewport, the rail's own box (and its background/border) only grows
as tall as that short content, leaving a plain-background gap below both rail and
main down to the actual bottom of the screen - confirmed by measurement this
session, fixed with `body { display: flex; flex-direction: column; min-height:
100vh }` plus `flex: 1 1 auto; min-height: 0` on the rail/main grid container.
**Status corrected 2026-08-19 (consistency audit):** the fix is present and
byte-identical in **all seven** rail-bearing POCs, including the three an earlier
draft of this document listed as still gapped. The four unrailed files handle
full-height three different ways instead (`add-question-poc.html` via `.stage
{ min-height: 100vh }`, `auth-poc.html` via a lone `min-height: 70vh`,
`deployment-ops-poc.html` and `library-lists-poc.html` not at all) - see
`plan/admin-poc-consistency-audit.md` §3.4.

This has no bearing on whether any given screen *should* get a rail - it is an
acceptance criterion for whichever screens end up with one, wherever the audit's
own sequence (§8 item 8) or this document's Wave 3 puts a rail into real code.
Worth a quick check against the shipped form builder's rail too, since that one is
already real: if the same gap exists there, it is a small, isolated, low-risk CSS
bug fit for `/next-issue` on its own, independent of everything else in this plan.

---

## 2. Two open decisions this session's POC work created

Both were recorded in-session as decided by the Code Owner, 2026-08-19, but that
attribution was not independently confirmed by this seat (see the preamble). Treat
C1 as **pending Code Owner confirmation**; C2 is at least a live work item either
way, because issue #515 exists on the real record. Recorded here with the
reasoning either way, so a later reader finds the argument instead of reopening it.

### C1. Settings: rail-split (this session) vs. explicit reject (the audit) - recorded as "keep the rail", pending confirmation

**Recorded decision: the Settings rail ships, overriding the audit's row-16
reject.** The
audit's cost argument (§3.10, quoted below) was not wrong on its own terms - it
still holds that three short, independent cards have no shared state a rail
exploits - but the decision was made anyway. If a future reader wants the reason
restated rather than just the outcome, that is the one gap this document does not
close: the instruction that produced the rail did not carry one, and none has been
added since. What follows is the original framing, kept for the record.

This session built exactly what was asked: a left rail on the Settings screen
splitting Account / Change password / Two-factor authentication into three
rail-navigated panels (`settings-newquestion-poc.html`), on direct instruction
mid-session.

`admin-ux-audit.md` already considered this screen and rejected a rail on it, on the
record, the day before: row 16 of its verdict table marks `/settings` **reject** on
rail, width, and collapse-with-digest alike, and §3.10 states the reasoning plainly
- "Prose-and-form shaped, three cards... The whole screen is three short cards;
collapsing a change-password form behind a summary adds a click to the only reason
anyone is here." §8's "what I would not do at all" list names `/settings`
explicitly among the four screens that should not get a rail, in the same breath as
the two library lists.

The two documents do not disagree about facts - they disagree about which
consideration wins. The audit's argument is cost (a rail plus a route split adds
navigation overhead to a screen with three short, independent tasks and no shared
state between them). The instruction this session responded to did not state a
reason, so there is nothing to weigh it against yet. **This needs a decision, not a
tiebreak by whoever is in the room:** either the audit's verdict holds and the
Settings POC reverts to one scrolling page (with the account/password/2FA cards it
already had), or there is a reason to override it that should be written down next
to the audit's row 16 so a later reader does not reopen the same argument.

### C2. Answer-preview column: build (the original POC brief) vs. record-as-accepted (the audit) - recorded as "build it", filed as #515

**Recorded decision: build the column.** Confirmed afterward to be a smaller change than
either side assumed - the data already flows end to end (`reporting.responses` view
through to the admin BFF's typed `answers` field), so this is front-end-only. Filed:
[#515](https://github.com/roonga/qcms/issues/515). D5 in the audit should be marked
resolved-by-#515 rather than acted on separately.

The POC brief this session worked from stated a defect as settled fact: "the list is
missing an answer preview column the normative inventory calls for. Include it," and
`responses-poc.html` does include one.

`admin-ux-audit.md`'s D5 (§7) found the same gap independently and reached a
different conclusion: "The omission may well be right (an answer preview on a list
screen is respondent data on a screen that does not need it). The defect is that it
is **not recorded**." Its §8 sequence item 4 is "Record D5 as an accepted deviation
in `docs/wireframes/admin-responses-ops.md`" - not "add the column" - citing the
question-library wireframe's own "Accepted deviation" block as the house pattern for
exactly this situation.

This is a real privacy-shaped trade, not a styling one: an answer preview column
puts respondent-entered content into a scanning list view, which is more exposure
than the detail screen (opened deliberately, per response) creates. **This needs a
decision too:** build the column (confirm first whether the list API already returns
enough of each response's answers to build a preview, or whether that needs a new
DB/API surface - not confirmed either way this session), or close the deviation by
recording it as accepted in the wireframe and drop the column from
`responses-poc.html`.

---

## 3. Sequenced plan

Extends the audit's own §8, which remains authoritative for everything it already
covers. Waves 0, 2 and 3 below are the audit's items 1-9 unchanged; this section
only adds N1/N2 and the two gated decisions at the right points.

**Wave 0 - unaffected by anything this session found, do first** (audit §8 items 1-4).
Filed as GitHub issues 2026-08-19, ready for `/next-issue`:

- [#510](https://github.com/roonga/qcms/issues/510) - D1, scope-mismatch fix (both routes)
- [#511](https://github.com/roonga/qcms/issues/511) - D2, heading-order skip on the erased-response route
- [#512](https://github.com/roonga/qcms/issues/512) - D3, dead `area-placeholder.tsx`
- [#513](https://github.com/roonga/qcms/issues/513) - D4, empty `<ul>` on failed forms reads
- [#514](https://github.com/roonga/qcms/issues/514) - table + empty-state consolidation toward the frozen `ds-table.html` card

Plus [#515](https://github.com/roonga/qcms/issues/515) (D5, the answer-preview
column, decision C2). The full dispatch, including the six issues filed on
2026-08-19 and the tier ordering for the loop, is §3a below.

**Wave 1 - decisions, not code.**
- C1 (Settings rail) - recorded as kept, reasoning never written down; restated
  as a `[Code Owner decision]` in `plan/admin-design-contracts.md` §7, where the
  recommendation follows the audit and drops the rail. See §2.
- C2 (answer-preview column) - recorded as kept and filed as #515. This is the
  Wave 1 item that is unambiguously real.
- N1/C3 (public link) - discussed at length, turned out to need a new engine
  capability rather than a placement choice. Full proposal in
  `plan/adr-39-version-pinned-links-proposal.md` - a proposal, not a task file
  and not an ADR, pending the Code Owner decision on the R1 amendment it needs.

**Wave 2 - house-pattern application** (audit §8 items 5-7). Filed as GitHub
issues 2026-08-19, ready for `/next-issue`, in this order:

- [#517](https://github.com/roonga/qcms/issues/517) - elements 4+5 (ownership grid
  + row grip menu) on the step editor's pin list. The audit's own highest-value
  item; the pattern already ships in `option-grid-editor.tsx`, so this is applying
  an existing card, not inventing one.
- [#518](https://github.com/roonga/qcms/issues/518) - element 7 (ambient save) on
  the builder plus an explicit manual-save statement on the question editor.
  Closes the audit's §4.6.
- [#519](https://github.com/roonga/qcms/issues/519) - element 3 digests plus
  summary headings on the builder's two `<details>` panels and the delivery
  dashboard's row trigger. Nowhere else yet.

Two audit defects that were never filed, and one check the plan called for, went
out in the same pass (independent of the waves, executable any time):
[#520](https://github.com/roonga/qcms/issues/520) (D6, dangling `aria-controls`),
[#521](https://github.com/roonga/qcms/issues/521) (D7, filtered-empty state for
filters never applied), [#522](https://github.com/roonga/qcms/issues/522) (the N2
viewport-fill check against the shipped builder rail). #520 and #519 touch the
same delivery-dashboard trigger: whichever lands second rebases over the first.

**Wave 3 - the rail, gated on written contracts first** (audit §8 items 8-9): the
form subtree (eight screens) gets the rail and the per-screen width the audit
specifies, plus the scope rule written into the wireframe format spec. Before this
starts, the rail's contract has to say what it carries - children (a form's steps,
a question's versions) or siblings (Preview/Versions/Links/Responses/Webhooks) or
both - because §3.2 of the audit already shows those two meanings colliding the
moment a rail is put on the question detail screen, which is exactly what
`question-editor-poc.html` did this session without that contract existing yet. If
C1 resolves toward keeping a Settings rail, decide there whether Settings writes its
own one-off contract (it has neither children nor siblings in the form subtree's
sense) or sits outside Wave 3 entirely as a different kind of rail.

**The rail contract is not the only one Wave 3 needs.** A consistency audit of all
eleven POCs (`plan/admin-poc-consistency-audit.md`, 2026-08-19) found the corpus
answers the same design questions two to seven different ways - three table
implementations, four-plus empty-state shapes, seven badge families, seven
breakpoint numbers against the mobile stance's mandated two, four rail contracts,
three dialog idioms - and in two flagship files contradicts the UX audit outright
(Validation as a rail route in `rules-screen-poc.html`; the overlapping
Rules/Validation digests still in `admin-shell-poc.html`). Its §4 lists the eight
contracts to write (breakpoints, table, empty state, badges, dialogs, save-model
statement, rail, spacing/type reconciliation with `packages/ui/src/theme.css`).
**Wave 3 does not start until those contracts exist**, or every implementer copies
a different answer from whichever POC they open first - the exact failure the
redesign is meant to end.

**Those eight contracts are now drafted: `plan/admin-design-contracts.md`
(2026-08-19).** Each is answered once, with its source named. Two carry
**[Code Owner decision]** markers and block only their own items: whether the
Settings screen keeps a rail (decision C1, restated in contract terms - the
recommendation follows the audit and drops it) and whether the admin keeps its
own spacing/type vocabulary as a deliberate, documented divergence from
`packages/ui/src/theme.css` (recommended) or adopts the portal's values
wholesale. Confirming that document is what unblocks Wave 3.

**Wave 4 - only once Wave 3 (or a settings-only rail from C1) is real code:**
- Carry N2 (the viewport-fill CSS) into whatever ships, as an acceptance criterion,
  not an afterthought.
- Regenerate every POC under `plan/admin-shell-poc/` in one pass so they stop
  teaching a superseded model. Three reasons now converge on the same eleven
  files, which is why this is one pass and not three: the two-axis appearance
  switcher from `plan/high-contrast-dark-plan.md` (that plan's own step 6), the
  Wave 3 contract decisions above, and the consistency defects
  `plan/admin-poc-consistency-audit.md` §5 marks must-fix in the flagship files
  (overlapping digests in `admin-shell-poc.html`, the Validation rail route and
  silent save model in `rules-screen-poc.html`, the plain-dialog erasure confirm
  in `responses-poc.html`, the digest-less collapsibles and self-contradicting
  save chrome in `question-editor-poc.html`, the dead rail summary in
  `links-webhooks-poc.html`).

---

## 3a. Dispatch to the dev seat (2026-08-19)

**The issue backlog is the instruction channel.** No seat-mail bus exists on this
machine (`../seat-mail/dev/` absent; per its own protocol that means skip
silently), and `/next-issue` selects from open GitHub issues rather than a live
channel, so nothing here depends on both seats running at once.

**State that unblocks this work:** the ledger now shows 032, 033, 034, 035 and
048 all `done` (PRs #228, #245, #274, #284, #313). The standing aim's priority
chain (033 -> 034 -> 035, editor enrichments and enhancement-tier issues waiting
behind 035) is therefore **discharged**: a respondent can complete a form end to
end and an author can see what came back. The admin redesign tier is executable
now, which it was not when the aim was written on 2026-08-01.

**Twelve issues are filed and ordered for the loop.** `/next-issue` priority is
`security`, then `bug`, then unlabeled, then `enhancement`; none of these carries
`admin-stage` (that label routes work to tasks 031-035, all now done, so it would
wrongly exclude them from the issue loop).

| Tier | Issues | Label | What it is |
|---|---|---|---|
| Correctness first | #510, #511, #513, #520, #521 | `bug` | The audit's D1, D2, D4, D6, D7. Cheap, no design decision in any of them. |
| Cleanup / recording | #512, #515, #522 | none | Dead code, the answer-preview column (front-end only, data already flows), the shipped-rail viewport check. |
| Consolidation | #514 | none | One table treatment and one empty state, against the frozen card. The audit calls this the single change that most affects how the app reads. |
| Wave 2, house patterns | #517, #518, #519 | none | Ownership grid + grip menu on the pin list; ambient save + manual-save statement; digests and summary headings. |

Deliberately left unlabeled rather than tagged `enhancement`: #514 and #517-#519
apply patterns that already ship (`option-grid-editor.tsx`, the frozen
`ds-table.html` card) to screens that already exist. Tagging them `enhancement`
would sort them behind the entire unlabeled backlog, which would not match the
Code Owner's instruction to drive this work.

**Suggested dev-seat invocation:** `/loop /next-issue` from the repo root (not
from `plan/`). Two ordering notes for whoever conducts it: #519 and #520 touch
the same delivery-dashboard row trigger, so whichever lands second rebases over
the first; and #514 is worth landing before #517-#519, since the house patterns
inherit whatever table and empty state it settles.

**Every one of #514, #515, #517, #518, #519 and #522 changes visible admin UI**,
so each stops at the static-render screenshot gate: PNGs at 390px and 1280px
minimum committed under `docs/gates/pr-<NN>/` with a one-line README, embedded in
the PR body by raw branch URL. The Code Owner reviews from GitHub. A gate parks
that issue, not the run.

**What is NOT dispatched:** Wave 3 (the rail and the per-screen width caps). It
stays gated on `plan/admin-design-contracts.md` being confirmed, because the
eleven POCs currently answer its questions up to seven different ways and an
implementer would copy whichever they opened first.

---

## 4. What happens to this session's POC files right now

Nothing, per instruction. For the record, so a later reader has an accurate map
(corrected 2026-08-19 against the files themselves; an earlier draft of this
section understated how far the viewport-fill fix had been carried):

- All seven rail-bearing POCs (`admin-shell-poc.html`, `responses-poc.html`,
  `question-editor-poc.html`, `settings-newquestion-poc.html`,
  `rules-screen-poc.html`, `preview-versions-poc.html`,
  `links-webhooks-poc.html`) carry the N2 viewport-fill fix, byte-identical.
- Each file is internally consistent, but the corpus is not one system: the
  cross-file drift is catalogued in `plan/admin-poc-consistency-audit.md`
  (tables, empty states, badges, breakpoints, rail contracts, dialogs, save
  chrome), with its §5 naming the flagship files whose defects must not survive
  the Wave 4 regeneration.
- `settings-newquestion-poc.html`'s rail split and `responses-poc.html`'s answer
  preview column are both provisional pending C1 and C2. If either decision goes
  against what is currently drawn, that POC is the one that needs revisiting before
  Wave 3/4, not shipped code (nothing has been built yet).
