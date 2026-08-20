# Admin design contracts (Wave 3 gate)

**Status: CONFIRMED by the Code Owner, 2026-08-20.** All eight contracts are now
normative. C1 is closed at §7a (Settings keeps a rail as a written exception) and
§8 is closed in the Code Owner's framing (portal and admin are different apps);
contracts 1-6 were confirmed in the same ruling ("all agree").

**Wave 3 is unblocked.** Anything a POC draws that contradicts a contract here is
wrong by definition, and that is now a statement about shipped work rather than
about proposals: `plan/admin-shell-poc/*.html` remains eleven inconsistent
proposals, and this document is the tiebreak whenever they disagree.

Original header follows.

**Status:** draft for Code Owner confirmation, PM/PO seat, 2026-08-19. This is the
document `plan/admin-redesign-implementation-plan.md` §3 gates Wave 3 on: the
eight questions `plan/admin-poc-consistency-audit.md` §4 found the eleven POCs
answering two to seven different ways, each answered exactly once. Every contract
below is a recommendation with its source named; the two marked **[Code Owner
decision]** are genuinely open and block only their own items, not the rest.

Once confirmed, these contracts are normative for Wave 3 implementation and for
the Wave 4 POC regeneration. Anything a POC draws that contradicts a contract is
wrong by definition; the contract does not bend to the drawing.

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

## 3. Empty state

The frozen card's shape, everywhere: centred panel, `1.5px dashed
var(--color-border-strong)`, surface background, an `h2`, one sentence, and a
primary CTA when a creating action exists on that screen. Variations:

- Filtered-empty keeps the panel, swaps the heading to "no matches", keeps the
  clear-filters action as the CTA, drops the explanatory sentence.
- Error states are not empty states: a failed read renders the error alert and
  nothing else (no empty `<ul>`, no "no items" claim - issue #513's rule).
- The bare muted paragraph and the "reassuring" green variant retire.

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
   The form-subtree rail (§7) carries navigation between *routes* and explicitly
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
*unstated* difference, not the difference.

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

---

## What confirmation unblocks

Wave 3 (`plan/admin-redesign-implementation-plan.md` §3): the form-subtree rail,
the per-screen width caps, and the scope rule in the wireframe format spec - all
implemented against these contracts rather than against whichever POC an
implementer opens first. The Wave 4 regeneration then brings all eleven POCs into
line with the same eight answers in one pass.
