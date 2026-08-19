# Admin app: narrow-viewport stance

**Status:** Code Owner decision, 2026-08-18. **Scope: `apps/admin` only.**

> **This document governs the admin app and nothing else.** It does not apply to
> `apps/portal`, which is respondent-facing and carries a materially stricter bar:
> mobile is a primary target there, not a degraded one, and the component rules add
> a no-JS path per control (`docs/COMPONENT_GUIDELINES.md` item 7, where silence is
> not an exception). Nothing below may be cited as portal precedent. If a change
> touches both apps, the portal's requirements win in the portal.

## The decision

The admin app is **not required to offer its full authoring experience on a phone**,
but it is required to support one specific workflow at narrow widths:

> An author away from their desk, shortly before a form goes out, can find out that
> publishing is blocked, fix the blocker, and publish.

That is a supported workflow, not graceful degradation. Everything else at narrow
widths only has to be **not broken**: legible, navigable, and free of overlap,
clipping and horizontal scroll.

The distinction matters because the two bars have different verification costs. The
supported path needs to be exercised. The rest needs to not be visibly wrong.

## What must work at 390

Ordered as the workflow runs, because that is how it should be tested.

| # | Capability | Why it is on the list |
|---|---|---|
| 1 | See that publish is blocked, and why | The validation issue list is the entry point to the whole scenario. If this is unreadable at 390 nothing else on this list can be reached. |
| 2 | Follow an issue to the thing that caused it | The issues are anchored links. `plan/admin-ux-audit.md` records that moving validation to its own route would break these, which makes the anchors a constraint rather than an implementation detail. |
| 3 | Reorder questions within a step | A common last-minute repair, and the one most affected by the reorder decision below. |
| 4 | Remove a question from a step | Same. |
| 5 | Change a question's version pin | The version column therefore survives at 390 even where other columns are dropped. Recorded as a layout rule below. |
| 6 | Change a form setting | Fewer occasions call for it, but it is cheap to keep and it is form-level state that can block a launch. |
| 7 | Publish, including its confirmation | The point of the exercise. A path that reaches the publish button and cannot complete it is worse than one that never started. |

## What is explicitly not required at 390

Declining these is a decision, not an omission. Each is listed with its reason so a
later reader does not read the gap as an oversight and fill it.

- **Building a form from scratch.** Nobody does this on a phone, and designing for it
  would compromise the desk experience that everybody actually uses.
- **Editing condition trees.** A nested boolean editor beside a JSON pane is a desk
  task. Attempting it at 390 produces a poor phone interface and pressures the
  desktop one into being simpler than the domain is.
- **Destructive and irreversible operations**: respondent erasure, and any one-time
  secret reveal for secure links or webhooks. These have deliberate friction
  (type-to-confirm, shown exactly once) precisely so they are hard to do by accident.
  A cramped screen is the wrong place to relax that, so the recommendation is to
  **decline them at narrow widths rather than render them cramped**.

## Layout rules

Four independent breakpoints were chosen across three prototypes. They should be
reconciled to one named set before any of this is implemented, because four
arbitrary numbers in five files is how a responsive layer becomes unmaintainable.

Measured from the prototypes as they stand:

| Prototype | Breakpoints present |
|---|---|
| `plan/admin-shell-poc/admin-shell-poc.html` | 639, 1023, 1024 |
| `plan/admin-shell-poc/add-question-poc.html` | 900 |
| `plan/admin-shell-poc/rules-screen-poc.html` | 999, 1024 |

**Recommendation: adopt two breakpoints, not four.** A `compact` boundary around
640 and a `sidebar` boundary at 1024, with everything currently keyed to 900 or 999
moved to whichever of the two it is really expressing. Name them once and refer to
the names.

> **Addendum (2026-08-19):** the measurement above is a snapshot of three
> prototypes; the corpus has since grown to eleven and the count went the wrong
> way: **seven** distinct numbers now appear (420, 480, 639, 900, 999, 1023,
> 1024), none of them tokenized, and the same option-grid component collapses at
> 639 in one file and 480 in another. Full per-file inventory:
> `plan/admin-poc-consistency-audit.md` §3.4. The two-breakpoint recommendation
> stands unchanged and is now a written precondition of Wave 3 in
> `plan/admin-redesign-implementation-plan.md` §3.

The behavioural rules the prototypes established, which should survive whatever the
breakpoints are renamed to:

- **The rail collapses to a disclosure below the sidebar boundary**, and its collapsed
  summary names the active step and that step's issue count. Collapsing navigation
  hides the choices, never the current position.
- **The questions grid may drop Type and Issues at compact width, and must keep
  Version.** Changing a version pin is on the supported path above.
- **Panes stack rather than shrink.** Dialog panes, and the rule card's editor and
  JSON pane, stack vertically rather than compressing side by side.
- **Any scrollable list carries a minimum height.** A flex item with `overflow: auto`
  resolves its automatic minimum size to zero and will collapse to nothing; this was
  observed in a prototype where a list rendered 41px tall around 529px of content.
- **Wide content scrolls inside its own container.** The page body never scrolls
  horizontally at any width.

## Width is not one number

The instinct to widen everything is wrong for this app. `plan/admin-ux-audit.md`
found that the two preview surfaces render what a respondent sees and therefore
inherit the respondent's measure: those want a **narrower** cap, not a wider one, and
a blanket raise would be wrong for most screens in the app.

So width is a per-screen property: workspace screens earn it, prose-and-form screens
keep a readable measure, and preview screens take the respondent's.

## Consequences already accepted elsewhere

**Reorder needs a single-pointer path, and on a phone that path is the primary one.**
WCAG 2.2 SC 2.5.7 (Dragging Movements, Level AA) requires that anything operable by
dragging also be achievable with a single pointer without dragging. Keyboard support
satisfies SC 2.1.1 and does not discharge 2.5.7. Drag on a touch screen is awkward at
the best of times, so the menu's move items are not a conformance formality here:
they are how reordering actually happens on the supported path.

## Open, and not a layout question

**"On a plane" implies connectivity, not only width.** The builder autosaves, and what
it does on an intermittent connection is unspecified. That is a data-loss question
rather than a responsive-design one, and it is the difference between a last-minute
fix and lost work. It should be answered on its own terms rather than folded into a
breakpoint.

## Verification

The supported path is exercised, the rest is checked for absence of breakage.

- **Supported path:** walk items 1 to 7 at 390 and confirm each completes.
- **Everything else:** at 390, no horizontal page scroll, no overlapping text, no
  clipped control, and no interactive element that cannot be reached.
- The screenshot gate already requires evidence at 390 and 1280 minimum, so narrow
  widths are reviewed on every UI task whether or not they were designed for. That
  is an argument for settling this now rather than discovering it at a gate.
