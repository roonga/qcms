# Admin design contracts (Wave 3 gate)

**A ninth contract was added 2026-08-21** (§9, author-authored text of unbounded
length). It is **not** covered by the confirmation below, which was given over
eight: it was found by shipping Wave 3 rather than by the POC audit, and it is
flagged for the Code Owner as a new answer rather than a restatement of a
confirmed one.

**Status: CONFIRMED by the Code Owner, 2026-08-20.** All eight contracts are now
normative. C1 is closed at §7a (Settings keeps a rail as a written exception) and
§8 is closed in the Code Owner's framing (portal and admin are different apps);
contracts 1-6 were confirmed in the same ruling ("all agree").

**ALL DESIGN AND TECHNICAL LIMITS ON THE ADMIN ARE REMOVED, 2026-08-22 (Code Owner):**
_"remove all limits on the admin portal."_

Taken together with the ruling below, this means the admin is built to its POCs and to
nothing else. **No contract in this document constrains an admin screen against its own
POC.** Where a POC draws it, that is the design: buttons where it draws buttons, JavaScript
where it needs JavaScript, per-screen widths where it sets them, and whatever rail each
screen's POC gives it.

The clauses below are retained as **description and rationale**, not as constraints. They
remain useful for a screen no POC covers, and for explaining why shipped code looks as it
does. They no longer overrule a drawing.

**Three things this seat has NOT removed, because they are not design limits and removing
them is a product decision rather than a workstream one.** Named here so the omission is
visible rather than assumed, and awaiting an explicit word either way:

- **WCAG 2.2 AA.** A standing non-negotiable in this seat's charter, a Code Owner human gate
  at task 030, and §8's own ruling says "different apps" never licensed a different
  accessibility standard.
- **ADR-27** (no hardcoded user-facing strings, locale-aware formatting).
- **SEC-1 to SEC-13.** Security controls, verified as a system by task 040, whose sign-off
  is a launch gate.

If "all limits" is meant to include any of those three, say so plainly and it is recorded
the same way. This seat will not infer it from a design instruction.

**AUTHORITY REVERSED, 2026-08-22 (Code Owner): the POCs win. "This is the approved
design."**

This document was written on the opposite premise, stated twice below: _"Anything a POC
draws that contradicts a contract here is wrong by definition; the contract does not bend
to the drawing."_ **That is no longer the rule.** Where `plan/admin-shell-poc/*.html` and a
contract here disagree, the POC is the approved design and this document is what changes.

The Code Owner's example, and the case that prompted the ruling: `question-editor-poc.html`
draws a rail carrying a `.rail-lifecycle` **action block** (`:589-598`). §7 says the rail
never carries actions. That §7 clause was overruled during the POC work, and the ruling
stands generally rather than only for that screen.

**A blocker this seat raised and then withdrew.** I first recorded that "the POC wins" was
underdetermined because the eleven POCs contradict each other, citing four rail contracts and
five main caps from `plan/admin-poc-consistency-audit.md` §4. **That was wrong, and the Code
Owner corrected it: there is one POC per screen.** Checked rather than argued -

- `admin-shell-poc` draws the step screens (`<h1 class="step-heading">Life insurance`,
  `Step 2:`); `rules-screen-poc` draws the Rules screen (`<h1 class="rules-h1">Rules`).
  Different screens.
- All eleven carry distinct titles: the shell, the rules screen, the question editor,
  library lists, links and webhooks, preview and versions, responses, deployment ops,
  settings and new question, the add-question dialog, and auth. **No two draw the same
  screen.**

So the four "rail contracts" were four **screens** each drawing its own rail, and the five
"main caps" were per-screen caps. Neither is a contradiction. They read as one only under the
assumption that a single component must serve every screen - which is the assumption this
document imposed, and which the ruling above removes.

The consistency audit's framing needs reading in that light: what it recorded as _"the same
eight questions answered two to seven different ways"_ is, under this ruling, **per-screen
specification** rather than inconsistency.

**Wave 3 is unblocked.** Anything a POC draws that contradicts a contract here is
wrong by definition, and that is now a statement about shipped work rather than
about proposals: `plan/admin-shell-poc/*.html` remains eleven inconsistent
proposals, and this document is the tiebreak whenever they disagree.

Original header follows.

**Status:** draft for Code Owner confirmation, 2026-08-19. This is the
document `plan/admin-redesign-implementation-plan.md` §3 gates Wave 3 on: the
eight questions `plan/admin-poc-consistency-audit.md` §4 found the eleven POCs
answering two to seven different ways, each answered exactly once. Every contract
below is a recommendation with its source named; the two marked **[Code Owner
decision]** are genuinely open and block only their own items, not the rest.

Once confirmed, these contracts are normative for Wave 3 implementation and for
the Wave 4 POC regeneration. Anything a POC draws that contradicts a contract is
wrong by definition; the contract does not bend to the drawing.

**Standing correction, 2026-08-22 (Code Owner): there is NO no-JS requirement in the admin.**

Several arguments in this document, and at least one instruction this seat gave a lane,
treated "works without JavaScript" as an admin constraint. **It is not one.**
`docs/PROJECT_GOAL.md:339` scopes it: the no-JS path exists for _"the browsers an
institutional or government **respondent** runs"_ - the portal. The admin's auth screens
keep named no-JS route handlers for a different reason entirely (ADR-35 / SEC-1: not moving
the flow into client JavaScript and republishing the endpoint set), which is an architecture
constraint on that flow rather than a general rule.

What this invalidates, named so it is not re-derived:

- **§7's "rail items are anchors, not buttons" loses its no-JS justification.** An anchor is
  still the right element for a row that _navigates_ to another route, because that is what
  an anchor means and it is what makes open-in-new-tab work. That half stands. The no-JS
  half does not, and it was never the admin's requirement.
- **§7a's Settings rail was built on the wrong constraint.** #562 chose fragment anchors and
  `:target` over the POC's panel-switching buttons, and this seat told that lane the rail
  "must remain usable without JS" as a floor. **That instruction was wrong.** The POC draws
  `<button>` elements calling `showSettingsPanel()`, and under the POC-wins ruling above,
  that is the approved design.
- **#570's anchor work is unaffected.** Its argument had two halves - a whole-row click
  handler is a control only a mouse understands, and it cannot be opened in a new tab.
  Neither depends on scripting being off.

## 1. Breakpoints

Two, tokenized, no others:

- `--bp-compact: 640px` - below it, tables drop their droppable columns (the
  Version column never drops, `plan/admin-mobile-stance.md`), side-by-side panes
  stack, and dense chrome tightens.
- `--bp-sidebar: 1024px` - at and above it, the rail is a 240px grid column; below
  it, the rail collapses to a disclosure.

Everything the POCs key to 420, 480, 639, 900, 999 or 1023 moves to whichever of
the two it is really expressing (639/1023 are the same boundaries written as
max-width; 420/480/900/999 are ad hoc and retire). "Panes stack rather than
shrink" keys to `--bp-compact` unless the panes are the rail itself. Media
queries cannot read custom properties, so the token is the single named constant
in the sheet header that every query cites by comment; the number appears nowhere
else.

## 2. Table

One family, reconciled with the frozen card (`plan/admin-theme/ds-table.html`):

- One class family (working name `qcms-table`), one scroll wrapper, one
  positioning-region wrapper for row menus. The three POC families (`.qgrid`,
  `.ops-table`, `.lib-table`) and the shipped trio (`plan/admin-ux-audit.md`
  §4.1) all converge on it.
- 44px rows (`--admin-table-row-h`), header 0.72rem strong-border underline, cell
  padding 0.4rem 0.6rem, `tabular-nums` on numeric and stamp columns.
- No zebra striping. Rationale: the 44px row and hairline dividers carry the row
  rhythm; zebra fights the ownership-grid contrast (element 4) where the two
  meet, and the frozen card does not stripe.
- Row action: the row's identifying cell carries a real anchor (open-in-new-tab
  and no-JS work); whole-row `onRowAction` click is retired with the kit-table
  migration. Rows with an author-controlled order get the grip menu; rows without
  one get a plain trailing menu or inline actions, never a grip.
- Sortable headers, selection column and skeleton state ship only where a screen
  needs them (none does today); when one does, it uses the frozen card's shape
  (`aria-sort` headers, leading checkbox column) rather than inventing its own.
  The card remains the spec for those parts even while nothing exercises them.
- Compact width: every table states which columns drop at `--bp-compact` and
  resets its `min-width` there so the scroll container is the fallback, not the
  default experience.

**Amendment, 2026-08-20 (Code Owner ruling): identifying columns, timestamps and
the wrapper's border.** All three were silent clauses that PR #571 hit in
practice - the first two escalated as ungoverned, the third decided under silence
and flagged. They are governed now.

- **An identifying column renders a prefix plus a copy affordance, never the full
  id and never an ellipsis.** Render the type prefix plus 8 characters
  (`ses_45cf6345`), monospace, tabular. The column has exactly two jobs -
  recognise a row against a ticket, and get the exact value into a search box -
  and a prefix serves the first while a copy control serves the second better
  than any width can. Nobody reads 32 hex characters.
  - **Ellipsis truncation of an id is forbidden.** A truncation that looks like
    data invites someone to copy a value that is not one. A stated prefix cannot
    be mistaken for a whole id; `ses_45cf6345…` can.
  - The copy control's accessible name carries the entity and the value ("Copy
    session id ses_45cf6345"), not a bare "Copy" repeated down the column.
  - The control is JS-only, and that is acceptable **because** the detail route
    carries the full id without JS - which it does since #510 headed those routes
    with their own entity. If a future table's detail route does not, the prefix
    rule still holds and the full id goes somewhere reachable without JS.
  - This prevents long identifiers from breaking into one-character columns and
    clipping row actions on compact screens.
- **A timestamp column renders date, `HH:MM`, and the zone. No seconds.** Seconds
  cost width in every row to answer a question the detail route already answers.
  Admin renders UTC with the zone named (task 034; operator-local display is a
  queued enhancement, not a licence to vary per table).
- **The table wrapper carries no border and no radius.** Six of the nine shipped
  tables had none, the frozen card's table takes its border from the surrounding
  card, and restoring it on the four kit tables would rebuild the two-treatment
  split this contract exists to remove. Three kit tables lose a border at #514;
  that is convergence, and it is now written down rather than inferred.

**Amendment, 2026-08-21 (escalated by PR #584): the prefix rule holds
for opaque ids and inverts for derived ones.**

The 2026-08-20 amendment was written against `ses_` and `lnk_` columns and reads
as though every id were like them. They are not. #584 escalated the case rather
than applying the clause to it, which was right.

- **Opaque ids** (`ses_`, `lnk_` - minted as random bytes, uniformly long) keep
  the 2026-08-20 rule exactly: prefix plus 8, monospace, tabular, a copy control,
  no ellipsis.
- **Derived ids** (`q_`, `opt_` - minted from author-written text) **render
  whole.** Never truncated to a prefix, never ellipsized. A copy control is still
  welcome; it is no longer the thing that makes the column usable.

**The distinguishing property is minting convention, not type, and it matters
that the type cannot carry it.** `packages/core/src/ids.ts:15` mints every brand
from one `idPattern` factory, so `^q_[a-z0-9_]+$` and `^ses_[a-z0-9_]+$` are the
same grammar - `ses_45cf6345` is an equally valid whole `SessionId`. What differs
is length convention. An opaque id is uniformly long, so a shorter one is
self-evidently a prefix. A derived id has no length convention at all, so **a
truncation of one is itself a syntactically valid id of the same kind, and
nothing on the screen distinguishes it from a whole one.** `q_accident_count` cut
to prefix-plus-8 is `q_accident`, a string that could perfectly well be another
question in the same form. That is the harm the anti-ellipsis clause already
names, arriving by a different route: a truncation that looks like data.

**A correction to the record, because this ruling was nearly built on a false
premise.** The PO review of #584 asserted that `q_accident` and `q_accident_count`
both exist in the golden corpus, making the collision demonstrable in-repo. **That
is wrong.** The corpus holds `q_accident_count` and `q_at_fault_accident`; there
is no `q_accident`, and no two ids in it share a prefix-plus-8. The argument above
is stated so that it needs no collision to exist today - it is about what a reader
can tell from the rendered string, which is the stronger form of the claim and the
one that survives someone checking it. The false claim is corrected on the PR as
well as here.

**Known deviation, named rather than shipped silently: the option grid ellipsizes
`opt_` ids today.** `.qcms-opt-cell--id` (`apps/admin/app/globals.css:929-938`)
sets `white-space: nowrap` with `text-overflow: ellipsis` inside the frozen card's
140px column, putting the whole id in a `title` tooltip and shipping no copy
control. Task 057 landed that on 2026-08-09 (`15a3ba7`), twelve days before this
amendment existed, so it cannot have rejected a clause that did not exist. Its own
comment records both the cause and the deferral: the Code Owner's minting ruling
keeps option ids label-derived, so a real `opt_roadside_assistance` overflows a
column sized for the mock's opaque `opt_8f2ka91m`, and the width is left as "the
card's call to revisit, not this task's to change".

So this amendment makes shipped code non-compliant on the day it lands. That is
stated here with an issue attached rather than left for a future reader to
discover as a silent contradiction. It also moves the column width out of the
card's hands and into this contract's: rendering a derived id whole is now what
the width has to accommodate, and the frozen card's 140px is evidence of an intent
formed before the rule existed, not an authority against it.

**Amendment, 2026-08-22 (from PR #624): a row that acts rather than navigates
takes a button, not an anchor.**

§2's row-action clause was written for tables whose rows go somewhere. `library-picker.tsx`
is a table whose rows **do** something: choosing one pins a question into the draft the
author is already editing, changes the page they are on, and closes the dialog they are in.

> Where a row has no destination, the identifying cell carries **no anchor**. The row gets a
> **`<button>` in a trailing action column**, whose accessible name carries the row's subject
> ("Add q_x version 2", never "Add" repeated down the column).

**Applying the anchor clause literally here would produce a link that lies.** There is no URL
meaning "having added q_x at v2", so an invented `href` would open, on a middle click, a tab
that does not do what the row said. That is worse than the whole-row handler it replaced, not
better.

The clause is satisfied by its **reasons** rather than its wording, and it is worth recording
which reason survives:

- **"A control only a mouse understands"** - the reason that applies. A button is a real,
  announced control reachable by Tab, and it takes **Enter and Space** where an anchor takes
  Enter alone. #624 presses Space in its e2e test deliberately, so a regression back to a
  link-shaped thing fails on a keystroke rather than on review.
- **"Open in a new tab"** - does not apply. There is nothing to open.
- **"Works without JS"** - does not apply, and never did. A modal dialog inside the builder,
  opened by a scripted control, over a draft held in client state, does not survive scripting
  being off by construction.

**This is not a general licence to prefer buttons.** The test is whether the row has an
address. If it does, §2's anchor clause applies unchanged, and the two shipped tables that
navigate are the reason that clause exists.

The frozen card's shape, everywhere: centred panel, `1.5px dashed
var(--color-border-strong)`, surface background, an `h2`, one sentence, and a
primary CTA when a creating action exists on that screen. Variations:

- Filtered-empty keeps the panel, swaps the heading to "no matches", keeps the
  clear-filters action as the CTA, drops the explanatory sentence.
- Error states are not empty states: a failed read renders the error alert and
  nothing else (no empty `<ul>`, no "no items" claim - issue #513's rule).
- The bare muted paragraph and the "reassuring" green variant retire.

**Amendment, 2026-08-20 (Code Owner ruling): what the panel does when the creating
action is already on the screen.** The CTA clause as written assumed the creating
action lives somewhere else and needs pointing at. On `/forms` it does not: the
creating action is a two-field fieldset on the same screen, and there is no
`/forms/new` route. PR #571 escalated this rather than inventing an answer, which
was right.

**The rule: when the creating action is already present on the screen, the panel
names it rather than duplicating it.** "Use the form above to create your first
form." No CTA button.

**The case that produced it is no longer a case (issue 685).** The rule above stands
and is the answer for any screen that meets its condition. `/forms` no longer does:
`plan/admin-shell-poc/library-lists-poc.html` chooses a separate creation route for
BOTH library screens and names the forms list's inline card as the one that should
change, so the card is gone, `/forms/new` exists, and the panel takes §3's ordinary
primary CTA pointing at it. The POC is the authority for that (`docs/admin-constraints.md`),
and both of the premises this amendment reasoned from - "the creating action is a
two-field fieldset on the same screen" and "there is no `/forms/new` route" - were
retired by it rather than argued with. The exemption has no member left; the rule
kept its teeth for the next screen that has one.

The two alternatives were both worse, and it is worth recording why so neither
gets reinvented:

- **Putting the fieldset inside the panel** yields two controls with identical
  accessible names on one screen. Accessibility checks must reject that duplicate
  control structure.
- **A scroll-to control** is a new interactive pattern with focus-management
  obligations, invented to satisfy a clause rather than to serve a user. Under
  §7a's lesson, a new pattern arriving to fill a contract gap is exactly the thing
  to refuse.

**Amendment, 2026-08-21: "and nothing else" means nothing that makes
a claim about the failed read, not nothing at all.**

Two PRs have now read the clause broadly - #571 (#514) and #593 (#543) - and both
were right to. The wording invites the narrow reading anyway, so it is restated
here rather than re-litigated a third time.

**The rule: on a failed read, the screen renders the error alert and nothing that
states or implies anything about the collection that failed to load.** That
forbids the empty `<ul>`, the empty-state panel, a "no items" sentence, a zero
count, and - since #514 made the panel loud - a creating CTA presented as the
answer to an empty collection.

**What it does not forbid is chrome that remains true.** A page heading, a filter
control, a rail, and a creating action that genuinely still works are not claims
about the failed read. `forms/[formId]/webhooks/page.tsx` carries the case in its
own comment: an operator who cannot load the existing endpoints may still
legitimately need to add one, and suppressing the whole component to satisfy
"nothing else" would remove a working capability because a different read failed.

The distinction to hold onto is **claim versus capability**. A failed read costs
the screen its right to describe the collection; it does not cost the screen its
controls. #572 and #544 apply this across the remaining sites, and #572's
conclusion is the shape this contract expects: pass an explicit failed-versus-empty
distinction into the client components rather than collapsing both into `[]` at the
page boundary, with one answer for all of them instead of a third invented per
component.

## 4. Status badges

One family (`.qcms-tag`, the name the shipped app already uses), one metric
(0.75rem / 600 / 1px border / `--radius-sm`), and one colour-per-state map held
in one place in the sheet:

- draft = neutral, published/current = success, deprecated/superseded = muted,
  active = **success** (an active webhook endpoint is a healthy one; info-blue
  reads as "informational", which "active" is not), inactive = muted,
  dead-lettered = danger (one label: "Dead-lettered"), flagged = warning.
- One label per state. A state never has two names on two screens.
- Counts (issue badges) are the same family with a numeric body; they are not a
  second component.

## 5. Dialogs

- `role="alertdialog"` for every confirm whose action is destructive or carries a
  stated consequence (erase, revoke, rotate, deactivate, publish, close, reopen,
  step removal, retarget, redeliver-all); plain `role="dialog"` only for neutral
  input surfaces (mint, add, edit). This is the shipped app's own §4.5
  convention with its one stray (retarget) corrected, and it makes the POCs'
  plain-dialog erasure confirm wrong by rule.
- One overlay implementation: fixed-position backdrop, one dialog surface with
  `1px solid var(--color-border)`, one shadow recipe.
- One button order: primary or danger action first, Cancel last, left-aligned.
- Destructive confirms use `.btn-danger`; a destructive action never carries a
  primary-styled confirm button. Type-to-confirm stays reserved for erasure.
- No inline `<details>` confirms for anything consequence-bearing.

**Amendment, 2026-08-22 (Code Owner, from the running app): the content column and the top
nav are LEFT-ANCHORED, not centred.**

Nothing in these contracts ever said which, and everyone assumed. The shipped app centres
both: at 1280 the Settings body sits with equal margins either side of its cap, and the top
nav's items are centred within theirs. **The rail is what made it visible** - a fixed 240px
column on the left with a centred body beside it reads as two unrelated layouts on one
screen.

> The capped content column is **anchored to the left** of its available space, not centred
> within it. Where a rail is present the column begins at the rail's edge. **The top nav is
> anchored the same way**, so the product mark, the nav items and the page content share one
> left edge down the screen.

**This is not a new preference, it is the design language the campaign adopted.**
`plan/admin-ux-audit.md` §1 names element 2 as the **"wide left-anchored column"**. That is
what the audit assessed, what the POCs drew, and what these contracts were written to
settle - and the one word doing the work never made it into a clause, so the implementation
centred the column and no gate could tell.

The width caps #558 assigned per route are unchanged: a cap sets **how wide** the column may
be, and this says **where** it sits. The two were conflated only because a centred column
makes the question invisible.

**Follow-on, from the lane that implemented the above (#648 with #657).** Two corrections to
the paragraphs before this one, both found by reading the drawings rather than by a new
decision.

- **The top nav is not a centred bar to left-anchor. It is a capped bar, and no POC caps
  it.** Every POC that draws the shell writes `.topbar__inner { display: flex;
flex-wrap: wrap; align-items: center; gap: 1.25rem; padding: 0 1.25rem; min-height:
56px; }` with no `max-width` and no auto margin - ten of the eleven files, the eleventh
  being `auth-poc.html`, which drops the shell deliberately and so has no bar to cap. So `mx-auto` **and** `max-w-5xl` came off the bar, and off the footer with
  it. Removing the auto margin alone would have left a 1024px bar sitting at the left of a
  wider viewport, which is not a screen any POC draws.
- **The caps did move after all, and by a different issue.** #657 re-sourced all sixteen
  from each screen's own POC, which is the authority as of 2026-08-22; #558 had sourced them
  from `plan/admin-ux-audit.md` §6, correctly for its date. Eight of the sixteen changed. The
  sentence above is still true of #648 in isolation - anchoring moved no cap - and is no
  longer a description of the shipped table. `apps/admin/lib/measure.ts` names the POC and
  the selector behind every row.
- **Reading a multi-screen POC needs a rule, and this is it.** Six of the eleven files pack
  two or three screens behind a switcher, so a shared `.main` cap in one of them is ambiguous
  by construction: it may be that file's chrome or it may be every screen's answer, and the
  markup cannot say which. **An inner class is what disambiguates it.** Where the author
  wanted a per-screen width they wrote one - `deployment-ops-poc.html` gives its three
  screens `.ops-inner--responses` 900, `--erasures` 1180 and `--webhooks` 1820 over a `.main`
  with no cap at all (`:229`); `preview-versions-poc.html` gives two of its three screens a
  640px `.respondent-frame`. Where they did not, the shared `.main` stands for every screen
  in the file, which is how that same file's version-history screen takes its 1600. The rule
  is "inner class wins where present", not "a shared cap means nothing".
- **One drawn number has no token, and it is left open rather than guessed.**
  `.ops-inner--webhooks` is 1820px, wider than the widest cap the app has (100rem). `/webhooks`
  therefore keeps the cap it had and is the one route whose value does not match its drawing.
  Reaching it means adding a value to the vocabulary, which is a change to the scheme rather
  than an assignment inside it. Worth noticing for the Wave 4 POC regeneration: 900, 1180 and
  1820 match none of the app's caps, which reads as three screens drawn before the token
  scheme existed rather than against it.

## 6. Save model

Every screen states its model exactly once:

- Autosaving screens (today: the builder alone) carry the ambient save strip -
  persistent chrome, `aria-live="polite"`, and it is the only save statement on
  the screen.
- Manual screens with a Save button carry a visible statement of the manual
  model near the button, and never an ambient "Saved" strip beside it.
- Read-only screens say nothing (absence of chrome is the statement; no "live
  data" strips reusing the save-status styling for identity metadata).

Issue #518 implements the two shipped screens; this contract is what stops the
POCs' third and fourth variants returning.

**Amendment, 2026-08-21 (escalated by PR #585): one model per scope,
not per screen.**

"Every screen states its model exactly once" was true while a screen was one save
model. The builder is not: it autosaves, and it embeds panels of its own. #585
escalated two of them. Both are real, and they are **not the same category** -
written as one rule about embedded statements, the amendment would license an
arbitrary second Save button anywhere, which is the opposite of what §6 is for.

**The rule: a screen states one model per scope.**

- **A nested scope that persists states its own model.** `FormSettingsPanel` has
  its own persistence, its own control and its own live region. That is a genuine
  second save model, and it states itself where its control is, exactly as a
  manual screen would.
- **A nested scope that does not persist may disclaim that it does not.**
  `QuestionPreview` has no save control, no action, no submit and no persistence -
  local `useState` feeding the renderer. Its sentence is a sandbox disclaimer, and
  it is allowed on that basis alone.
- **A scope with no persistence never acquires a save control to justify its
  sentence**, and a disclaimer is never written in the save vocabulary: no
  "Saved", no timestamp, no reuse of the ambient strip's styling. The two
  vocabularies stay apart for the same reason the strip carries no issue count.

**The screen-level clause still binds at screen level.** The builder's ambient
strip remains the only _screen-scope_ save statement. A nested scope's statement
is not a second one, provided it is visibly bound to its own scope rather than
floating in the page chrome.

**Consequence to accept knowingly, and it ships today:** pressing "Save settings"
in the builder renders "Saved <time>" and "Settings saved." at once. Under this
amendment both are legitimate - they belong to different scopes - but together
they read as one screen contradicting itself about how many things just happened.
Separating them is a wording and placement job rather than a licence question, and
it belongs with #518's implementation, not here.

## 7. The rail

- The rail carries **navigation within one form's subtree**: the form's children
  (its steps, with per-step issue badges) and the form's sibling screens
  (Builder, Preview, Versions, Links, Responses, Webhooks). A question's version
  list counts as children on the question detail screen. That is the whole
  contract: two groups, in that order, with one divider.
- The rail never carries actions (no lifecycle buttons - those belong in the
  main column), never carries same-page section switches, and never carries a
  route the audit rejected (Validation stays on the builder page,
  `plan/admin-ux-audit.md` §5.5).
- Collapsed (below `--bp-sidebar`), the summary names the active item and, when
  the active item has an issue count, that count (`plan/admin-mobile-stance.md`).
  The summary text truncates with an ellipsis; the markup is one shared
  component, not per-screen copies.
- Rail items are anchors, not buttons.

**Amendment, 2026-08-22: the rail shows each screen's own name,
which for the version list is "History".**

§7's sibling list writes **"Versions"**; the shipped copy catalog calls that screen
**"History"**. #559 reported the mismatch, it reached #561 still unruled, and **two lanes
wrote the same paragraph of reasoning and each decided alone**. A third should not have to.

> The rail row carries **the name the screen carries**. Where §7's list and the shipped
> copy disagree, the copy wins and §7's wording is the loser.

The reason is #561's and it is adopted verbatim because it is better than a preference:
**the rail must not give a screen a second name for a place the breadcrumb and the screen's
own copy already name.** §7's normative content is _which_ siblings appear and _in what
order_; both are honoured either way, so the wording was never the part doing work.

So the rail reads the version list's own name, and §7's "Versions" above should be read as
identifying the route (`/versions`), not prescribing a label. The same rule applies to any
future rename: change the copy, and the rail follows without a contract amendment.

That rename arrived the same week. Issue 679 gave the five section screens an `<h1>` that
names the section before the form, which is what the approved drawing for this one carries
("Version history: Life insurance", `plan/admin-shell-poc/preview-versions-poc.html`), and
composing "History" into that heading would have read as the form's edit history rather than
its published versions. So `forms.tab.versions` is **"Version history"**, and the rail reads
Builder / Preview / **Version history** / Links / Responses / Webhooks. That is this
amendment being applied rather than revisited: the copy moved and the rail followed it.

**Amendment, 2026-08-22 (from PR #621): the disclosure is one element at
every width, and its summary stays visible when expanded.**

§7 described the collapsed state and said nothing about the expanded one, which left
the reference implementation free to answer a question the contract had not asked.
It answered it well, and this records the answer **before #561 and #562 inherit it as
precedent** rather than as a decision. A silent contract plus shipped code is exactly
how an unexamined choice becomes the house pattern.

- **One native `<details open>` at both widths**, not a rail plus a separate collapsed
  variant. Two components would mean **two copies of the same navigation in the DOM**,
  which is a real accessibility defect rather than a tidiness question, and a native
  disclosure is keyboard-operable by construction and announces its own expanded state
  more reliably than any hand-written `aria-expanded`.
- **The `<summary>` is not a visible label above `--bp-sidebar`.** It remains in the
  markup, because it is the disclosure's control and removing it takes the semantics with
  it, but it is not _shown_ as a heading on a wide screen.

  **Corrected 2026-08-22 by the Code Owner, overruling this seat.** The earlier text
  accepted the redundancy - the active item named once as the summary and again as the
  marked row - on the grounds that hiding it at one width reintroduces a second code path.
  Reviewing #621 I flagged the duplication and cleared it anyway. Seen in the running app
  it reads as a stray page title above the rail, and the Code Owner's call is to remove it.
  The disclosure semantics are kept by hiding the summary visually rather than by dropping
  it, which costs no second code path.

- **The Settings rail (§7a) follows the same mechanism**, being a different component with
  the same collapse behaviour. It does not get to answer this differently.

`components/rail-frame.tsx` is the shared chrome and `components/forms/form-subtree-rail.tsx`
is §7's contents; the split is what keeps §7a a distinct component that shares the column,
the width and the collapse behaviour and nothing else.

**Amendment, 2026-08-22 (escalated by PR #621): a step item is a fragment on
the builder, not a route.**

§7 says the rail carries the form's steps and never said what a step item points at. The
answer is:

> `/forms/{formId}#step-{stepId}` - the builder route plus the step's existing anchor.
> **A step is never given a route of its own.**

**This is not a preference, it is the audit's own negative result.** `plan/admin-ux-audit.md`
records that the POC "created the mismatch by moving to a step-scoped route and then had to
split it back out", and concludes: _"the mismatch is a consequence of the rail's
step-per-route model, not a pre-existing defect."_ Step-per-route is the thing that produced
the scope bug D1 belongs to. A contract that adopts the rail while leaving its link target
open invites the defect back through the one door it was known to come through.

The mechanism already exists and was minted for a neighbouring purpose: `stepAnchorId`
(`apps/admin/lib/forms/issues.ts:33`) gives every step a stable, focus-targetable DOM id, and
`components/forms/steps-rail.tsx:273` is what the validation panel's issue links resolve
against. §5.5 of the audit is the reason those anchors must keep working. So the rail reuses
the app's established focus-anchor rather than inventing navigation, and the two features now
depend on the same id, which is a property to preserve rather than an accident.

**Amendment, 2026-08-22 (escalated by PR #621 and issue #623): the rail sits
outside the capped content column.**

Three rules met for the first time in #559 and none of them composed: §7 makes the rail a
240px grid column, §6-as-implemented caps the **content** column per route, and N2 requires
the rail to reach the bottom. Nothing said **which of the two the cap governs**.

> The rail is a **sibling** of the capped content column, not a child of it. A route's width
> cap governs the content column alone, and the rail's 240px is additional to it.

Nesting the rail inside the capped column would silently subtract 240px from the measure
every route was assigned in `plan/admin-ux-audit.md` §6, and stand the rail on the content
column's padding. The failure mode is the reason this is worth writing down: **the symptom is
a slightly narrow screen, which nobody attributes to a contract silence.** It would be
absorbed as a styling nit rather than diagnosed.

The consequence is accepted rather than discovered: because a layout is never told which
child route rendered, a sibling rail needs a **parallel route slot**, and the shared tooling
has to understand one. #559 taught four files about it rather than filtering it out, which is
the standard for the next two rails as well.

**Amendment, 2026-08-22 (blocking #561): on the builder, the rail carries the
sibling-screens group only.**

PR #621 made Links its reference screen and declined to answer what the rail does on the
**builder**, which already renders a step list that is an _editor_ - buttons, same-page
selection, add, rename, reorder, remove. Adding §7's children group there would put two step
lists on one screen disagreeing about what a step row is. #561 wires all eight screens
including the builder, so this cannot stay open.

**§7 already decides it, and the derivation matters more than the answer.** A step item links
to `/forms/{formId}#step-{stepId}`. On every other form-subtree screen that is a cross-route
link. **On the builder it is the same route** - a bare fragment - which is precisely what §7's
existing clause bars:

> The rail never carries actions [...] **never carries same-page section switches** [...]

So the children group is not merely redundant on the builder, it is **already forbidden**. No
new rule is needed and none is invented here.

- **The builder's rail renders one group**: Builder / Preview / Versions / Links / Responses /
  Webhooks, with Builder marked active.
- **There is therefore no divider on that screen.** §7's "two groups, in that order, with one
  divider" describes the rail's contents where both groups exist. A missing divider on the
  builder is the rule working, not a defect, and a reviewer should not read it as one.
- **The builder's existing step editor remains the single step list**, and keeps its buttons.
  It is content, not navigation, which is why §7 never reached it.
- **One shared component still.** Omitting a group is _data_ passed to the rail, not a
  per-screen copy of it, so the "no per-screen copies" clause is untouched.

**What this does not settle.** Whether the builder's step editor should eventually _look_
like the rail's step group, or move, is a builder-layout question and remains open. It is not
answered by making it a second rail, and nothing here licenses that.

### 7a. Settings keeps a rail, as a written exception

**[Code Owner ruling, 2026-08-20 - decision C1 closed]** Settings keeps its rail.
This overrides the audit's row-16 verdict and this document's own recommendation,
both of which said no rail.

The condition attached to that option was that the exception be **written as
such** rather than left to become a silent third rail contract, so it is written
here, with its boundary defined. Two honest notes before the contract:

1. **The ruling is the Code Owner's; the boundary below is this seat's drafting.**
   No cause was stated for the override, and none is invented here. If the
   boundary as drawn is not what was intended, it is corrected on request - but
   something had to be drawn, because "Settings has a rail" without a scope is
   precisely the silent third contract the condition forbids.
2. **This is a genuinely different pattern, not the same rail on another screen.**
   The form-subtree rail (§7) carries navigation between _routes_ and explicitly
   never carries same-page section switches. A Settings rail can only carry
   same-page section switches, because Settings is one route. So the exception is
   not "the rail also appears on Settings" - it is a second, narrower component
   that happens to occupy the same grid column.

**The Settings rail contract:**

- It carries **same-page section links for one route** (anchors to the sections
  of the Settings page), and nothing else. No routes, no actions, no counts.
- It is a **distinct component** from the form-subtree rail, named distinctly in
  the code, so no future reader can mistake one for the other or "unify" them.
  They share the grid column, the 240px width, the `--bp-sidebar` collapse
  behaviour and the anchors-not-buttons rule - and nothing else.
- Collapsed below `--bp-sidebar`, it follows the same disclosure treatment as §7,
  with the summary naming the active section.
- **The exception does not generalise.** No third screen gets a rail without its
  own ruling recorded here. Sixteen authenticated screens exist; eight are
  form-scoped, and the other eight would get an empty rail or one duplicating
  their own body. Settings is now the single named exception, not the first of a
  series.

**Consequence to accept knowingly:** with this ruling the app ships two rail
patterns that look identical and behave differently, so the burden moves onto
naming and onto the Wave 4 POC regeneration to draw them as two things. That is
the cost of the option; it is affordable, and it is the reason the boundary above
is drawn tightly rather than loosely.

## 8. Spacing and typography reconciliation

The POC/`plan/admin-theme/tokens.css` vocabulary (`--admin-*`, `--font-admin`,
raw rem headings) and the shipped `packages/ui/src/theme.css` vocabulary
(`--space-*`, `--type-*`, `--font-portal`) are disjoint and their values differ
(control height 40 vs 44, section pad 1.25rem vs 2.25rem).

Recommendation: **deliberate divergence, aliased where values genuinely differ.**
The admin app is a dense operator tool and the portal is a respondent surface;
identical spacing is not a goal (ADR-30's managed-theme reasoning already
separates the two). But the divergence becomes explicit: the admin sheet keeps
its `--admin-*` names, gains an `--admin-type-*` heading scale (h1 1.4rem/700,
h2 0.95rem/700, replacing every raw literal), and a comment block in each sheet
names the counterpart token and why the value differs. What retires is the
_unstated_ difference, not the difference.

**[Code Owner ruling, 2026-08-20 - closed]** Divergence confirmed, in the Code
Owner's own framing: **"we are to treat portal and admin as different apps."**

That is a stronger statement than the recommendation asked for, and it settles
more than the token question, so the contract is written to match it rather than
to the narrower draft:

- **The two token vocabularies are separate systems by decision, not by
  accident.** Admin keeps `--admin-*` and `--font-admin`; the portal keeps
  `--space-*`, `--type-*` and `--font-portal`. Neither is the other's fallback,
  and a value differing between them needs no justification - difference is the
  default, not the exception.
- **The cross-referencing comment blocks in the original recommendation are
  dropped.** Their purpose was to explain a divergence that read as accidental.
  Under this ruling the divergence is the stated position, so naming a
  counterpart token in each sheet would only re-couple two systems the ruling
  just separated, and would invite a future contributor to "reconcile" them.
- **What survives from the recommendation, because it is a real defect
  independent of the ruling:** admin gains an `--admin-type-*` heading scale
  (h1 1.4rem/700, h2 0.95rem/700) replacing every raw rem literal. Raw literals
  are a problem whether or not the two apps share a vocabulary.
- **Where they must still agree, and this is not a token question:** ADR-27
  (i18n) and the WCAG 2.2 AA floor bind both apps. "Different apps" governs
  spacing, type scale and visual density; it does not license a different
  accessibility standard or a second way of handling user-facing strings.

Nothing in `packages/ui/src/theme.css` changes as a result of this ruling. The
portal's managed themes (ADR-30) are untouched.

**Amendment, 2026-08-22 (Code Owner): "different apps" governs CONSTRAINTS, not only
tokens.** The ruling above was written as a token decision and this seat read it that way,
which is how a **portal** requirement ended up justifying an **admin** design (see the no-JS
correction at the top of this document). The Code Owner has restated it twice: _"admin and
end user portal have different constraints. This work stream is purely admin."_

> **A constraint proven for the portal does not transfer to the admin, and must not be cited
> in an admin decision without being established for the admin on its own terms.** The
> portal's audience is respondents on unknown browsers; the admin's is authenticated staff.
> Those differ in device, network, scripting, session and threat model, and the burden is on
> whoever imports a rule to say why it applies here.

**The two floors that do bind both, unchanged from the ruling above:** **WCAG 2.2 AA** and
**ADR-27** (i18n). "Different apps" has never licensed a different accessibility standard or
a second way of handling user-facing strings, and does not now.

**The practical test**, since this seat failed it once: before citing a rule in an admin
decision, find where it is _stated_ and check what it is scoped to. `docs/PROJECT_GOAL.md`
scopes the no-JS path to _"the browsers an institutional or government respondent runs"_.
That sentence names its own audience, and reading it would have prevented the error.

---

## 9. Author-authored text of unbounded length

**A ninth contract, and it was not one of the eight.** The POC audit asked eight
questions about how components should look, and this document answered each once.
This one was never asked, because it is not visible in a drawing: every POC draws
an id that fits. It was found by shipping - **five sightings across four PRs in
three days**, each in a component that was fully compliant with the clause
pointed at it.

**The gap is structural rather than any component's fault.** Contracts 1 to 8
govern each container separately. So a component can satisfy the rule aimed at it
while the app as a whole has no answer to "what if an author names a question
`q_at_fault_accident_followup`". Nothing owns that question, so each container
answers it locally and differently: one ellipsizes, one wraps mid-token, one
chops at a container edge, one sits flush against it. Five components, five
answers, no rule. That is the defect, and it is why this is one contract rather
than five issues.

The sightings, verified against `origin/main` at `c9a5219` rather than recalled:

**Tier 1, characters are lost.** Forbidden for an id, anywhere, by any mechanism.

- **Ellipsis truncation.** §2 already forbids this, and it is restated here
  because §2 reads as being about _tables_ and the live instance is not one. The
  app has exactly four `text-overflow: ellipsis` sites
  (`apps/admin/app/globals.css:540, 1007, 1152, 1736`) and **only one truncates an
  id**: `.qcms-opt-cell--id` at `:1007`, the option grid (**#595**). The other
  three are a nav-menu email, a drag state, and the answer preview.
- **Chopping at a container edge**, with no ellipsis and no indication anything
  was cut (**#596**, the rule card between 640 and 767).
- **Table identifying columns** (**#582**) are the same rule reaching the case §2
  was actually written for.

**Tier 2, nothing is lost but the rendering still reads as a whole value.**
Permitted, with a condition, because it is materially better than tier 1 and
banning it would force tier 1 in narrow containers.

- A wrap that breaks mid-token loses no characters. `.qcms-pinrow__idvalue`
  (`:1394`) sets `overflow-wrap: anywhere` and no ellipsis, so
  `q_accident_count_2nqps` renders as `q_accident_count_2nq` / `ps` with every
  character present (**#584**'s frame). A heading sitting flush against a card
  edge is the same category (**#585**, reported during implementation; not
  independently verified here).
- **The harm is real anyway, and it is the harm §2's anti-ellipsis clause
  names:** the first line alone reads as a plausible complete id. Nothing on
  screen says otherwise.

**The rule, covering both tiers with one requirement:**

> Wherever an id is rendered, **the exact value must be obtainable without
> reading it off the screen**. A container that cannot guarantee the whole id
> renders unbroken provides a copy control, and never truncates.

That is not a new mechanism. It is §2's copy control, which exists for exactly
this reason, applied wherever ids appear rather than only in tables. It also
means a narrow container is no longer a design emergency: wrapping is acceptable
_because_ the value is recoverable, and truncation stays forbidden _because_ it
is not.

**The positive precedent, so the rule is not read as "never truncate anything".**
`.qcms-answer-preview` (`:1736`) is how a bounded field should behave: a cap
chosen by measurement against the 1280px gate frame, the measurement written into
the sheet beside it, and an ellipsis that means "there is more". It is legitimate
there **because the content is respondent prose rather than an identifier** - no
reader will mistake a truncated sentence for a complete one, and the exact value
is not something anyone needs to copy into a search box. Identifiers are the
special case, not the general one.

**What this contract does not decide.** It does not set the option grid's column
width (#595), the rule card's narrow-container behaviour (#596), or the table
columns' treatment (#582). Those remain their issues' work. What changes is that
all three are now answers to one question under one rule, instead of three
components each deciding locally and correctly-by-their-own-clause.

---

## What confirmation unblocks

Wave 3 (`plan/admin-redesign-implementation-plan.md` §3): the form-subtree rail,
the per-screen width caps, and the scope rule in the screen contract format spec - all
implemented against these contracts rather than against whichever POC an
implementer opens first. The Wave 4 regeneration then brings all eleven POCs into
line with the same answers in one pass - now nine of them, since §9 binds any POC
that draws an id, which is most of them.
