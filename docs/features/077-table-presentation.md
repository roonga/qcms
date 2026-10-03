# 077 - The table presentation

**Stage:** 8c (launch scope) · **Apps/packages:** `@roonga/qcms-ui`, `@roonga/qcms-core` (the column-type refusal), `apps/portal`, `apps/admin` (the column view and the filtered picker) · **Depends on:** 073
**References:** ADR-43 (a native `<table>`, never `role="grid"`; five cell types) · ADR-42 · ADR-38 (the theme scope carrier) · ADR-22 · SEC-16 · `docs/COMPONENT_GUIDELINES.md` · `plan/repeating-groups-and-table-input.md` sections 4.5 and 6.3, and Q10, Q12 · WCAG 2.2 SC 1.3.1, 2.4.11, 2.5.8, 3.3.2, 4.1.2 · issue #680

## Context

`presentation: "table"` lays instances out as rows and member questions as columns. Under ADR-42 **no question type is added**: every cell is an ordinary question with an ordinary `AnswerValue`, so per-cell validation, per-cell retraction, "empty is absence" per cell, the rules DSL, the ledger grain, the export grain and the reporting view all work unchanged, and `@roonga/qcms-ui` gains a **layout** rather than an input control. Under `docs/COMPONENT_GUIDELINES.md` that makes the rendering work checklist-sized rather than ADR-sized, and the checklist items that bind are the behavioural ones: the no-JS path, the focus targets, the theming tokens, the font sweep and lint coverage. Items 1 to 3 (vendoring, a registry entry, the ADR-31 commit moment) do not bind a layout container, and item 4's clear path binds the cells, which already have one.

**It is a native `<table>` and never `role="grid"`.** APG states as a defining property of the grid pattern that it "Requires the author to provide code that manages focus movement inside it", so with scripting off a grid renders as a tab-trap-shaped nothing, and this surface's no-JS claim is unqualified. The documented cost is one tab stop per cell, which is the expected behaviour of the choice rather than a defect.

## Deliverables

- **The table layout in `@roonga/qcms-ui`**, built on the markup and style map of the vendored `Table` in `packages/ui/src/components/a2ui/table/`. That component is exported from the admin Kit, is **not** in the renderer registry and is a read-only display table: it is the right starting point and it is not an input grid.
- **The structure**: `<table>` with a `<caption>` carrying the group label; `<th scope="col">` per column, the column label being the member question's own; `<th scope="row">` per row carrying the resolved instance label.
- **A real, visually hidden `<label>` on every input**, reading "Asset 3, Value AUD". Two reasons and the second is the one easy to get wrong: `scope` and `headers` associate a **cell** with header cells and no source found claims they contribute to the **input's** accessible name; and the 390px reflow removes the headers altogether, so a name that came from a header relationship goes with them. A real label per cell is the only encoding that survives both layouts.
- **A `<tfoot>` column total that is presentation only**: computed, drawn, never an input, never posted, never stored, never submitted, never exported.
- **The 390px card reflow**, one card per row, every input keeping the same accessible name, and above the reflow width an `overflow-x: auto` box which is the only element on a portal page permitted to scroll horizontally.
- **`position: relative` on the scroll box and on any button carrying a hidden label.** This is a structural trap rather than an incidental one, because this design puts a hidden label in **every** cell: a visually hidden label positioned with `position: absolute` inside an `overflow-x: auto` box resolves against the initial containing block when no ancestor is positioned, lands past the viewport edge and widens the **document**, producing exactly the horizontal page scroll the portal forbids. It cost 136 unexplained pixels on a concept page.
- **`TABLE_COLUMN_TYPE_NOT_ALLOWED`**, refusing `longText` and `multiChoice` as columns at publish. The five allowed cell types are `shortText`, `number`, `date`, `boolean` and `singleChoice`. **The refusal names the stacked presentation**, which allows all seven types, so an author refused here has somewhere to go.
- **The admin's column view of the member list**, which is the whole of the "column editor" (plan section 6.3): there is no table question, so the view is the group's member list rendered as columns, each row a column showing its label, its underlying question and its type, with the type **shown rather than chosen** because it is the question's own. Adding a column is adding a question to the group. **Task 074 defers both this and the picker below to this task**, so nothing here is shared.
- **The filtered library picker**, which offers only the five allowed types, says why, and names the stacked presentation as the alternative.
- ~~**Sticky header and footer proved against 2.4.11 Focus Not Obscured**~~ - **withdrawn, and replaced by its own criterion** (Code Owner, 2026-10-03, on the review of this task's PR). **2.4.11 Focus Not Obscured holds by construction, because this table pins nothing.** The deliverable as written was built and the declarations were inert: `position: sticky` resolves against the nearest scrollport, which is the table's `overflow-x: auto` box, and that box's block size is its content's, so it never scrolls on the block axis and neither the header row nor the total footer ever detached. Deleting both blocks changed no test, which is how the review found them. The ruling deletes the pin rather than making it real: making it real means constraining that box's block size to create a vertical scrollport inside a form step, and then discharging the obscuring risk the pin itself introduces with a `scroll-padding-block` nobody can prove exceeds every theme's control height. The pin's benefit is bounded by the group's own `max`, which SEC-16 leaves to the author, and the card reflow already drops the header on a phone. What survives is the **criterion**, asserted as a guard against a future pin rather than as a description of today's layout: `repeat-table.pw.ts` asserts that no header or footer cell is out of flow, that none overlaps the focused cell's box, and that nothing outside the focused element's own chain is painted over it, on a focused first-row cell and on the row header an Add lands focus on.
- **Target size (2.5.8)**: a per-row Remove control is the control most likely to fall below the portal's 44px `--space-control-h` floor, and it does not.
- **The theming and token work** `docs/COMPONENT_GUIDELINES.md` binds for a layout: treatments in `packages/ui/src/theme-components.css` beneath the ADR-38 scope carrier, the font sweep, the tabular-figures selector for a numeric column, and lint coverage.
- **A changeset** for `@roonga/qcms-ui`, and one for `@roonga/qcms-core` if the publish code lands here rather than with 071.

**The per-row Remove it renders rides task 073's mechanism unchanged** (Q28, ruled 2026-10-01): without scripting it is a `__qop` submit button on the step's own form, the form's action is a Next Server Action that re-renders in the same 200, and focus lands by `autofocus` on the ruled destination rather than by a fragment. A row's focus handle is therefore an `autofocus` target like an instance card's heading, and 2.4.11's sticky-header proof applies to the row the landing reaches.

## Exit criteria

Acceptance cases **39 to 45, and 62** of `plan/repeating-groups-and-table-input.md` section 11. This task owns those and no others; case 62 is the filtered library picker, which belongs here because it is this task's refusal being surfaced. Plus:

1. **No `role="grid"` anywhere**, asserted by searching the rendered DOM rather than by reading the source.
2. Every cell input's accessible name is asserted **from the accessibility tree**, not from the DOM, at both layouts.
3. The page has **no horizontal scroll** at 390px, which is the assertion that catches the hidden-label positioning trap.
4. axe reports no violation on a **filled** table at every viewport project.
5. `pnpm verify` green; `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` green, run detached, since this touches `apps/portal` and `@roonga/qcms-ui`.

## Files and areas

`packages/ui/src/components/` (the layout, built from the vendored table's markup), `packages/ui/src/theme-components.css`, the renderer's presentation branch, `packages/core/src/publish-error.ts` and the table-column validation, the admin's group panel column view and library picker, the portal and admin i18n catalogs, changesets.

## Gates

`pnpm verify`, and `QCMS_PORT_SEAT=<0-9> pnpm verify:browser` run detached (`verify:browser:detached`, then `verify:browser:wait <dir>` in slices until it stops exiting 75, never in the foreground: issue #846). Every spec runs on the Pixel 7 project by configuration, so the reflow is not a viewport this task opts into. No Docker-backed gate.

## Out of scope (binding)

**This is inside the launch cut-line and may not be deferred.** `docs/PROJECT_GOAL.md` section 5 promises the table presentation, so task 038 waits on this. It is ordered against 076 by demand, and ordering is not scope.

Also out: `role="grid"`, a roving tabindex and any edit-mode keyboard model, all refused by ADR-43. A `longText` or `multiChoice` column. Column reordering and row reordering: reordering needs a single-pointer non-dragging path (SC 2.5.7), which is the criterion issue #680 already caught the admin's option grid on, and it buys nothing the ordinal does not give. A stored aggregate: the column total is presentation only, and an author who needs it stored asks for it as a question. Any change to the cells' commit moments, which ADR-31's table does not move for a layout.

## Notes for the executor

**One tab stop per cell is the documented cost of the ruled choice**, not a defect to mitigate with script. APG says a grid is what you reach for when "the number of widgets is large", and this design's answer is the group's own `max` instead. Under SEC-16 there is no installation-wide ceiling, so a table's tab-stop count is `columns x max` for whatever its author declared; that is an authoring decision and this task does not second-guess it.

**The admin half lands as two standalone pieces, because its host is task 074's**
(recorded 2026-10-02, while building). The deliverable above says "Task 074 defers both
this and the picker below to this task, so nothing here is shared", which is true of the
files and not of the ordering: the group panel those two pieces are rendered _in_ is 074's,
and 074 was dispatched in parallel with this task rather than before it. So the column view
is a component of its own (`apps/admin/components/forms/table-column-view.tsx`) taking the
member pins, the library and an add handler as props, and the picker's filter is an opt-in
flag on the existing `LibraryPicker`. Neither reaches into panel state, so they wire up in
either merge order.

**Acceptance case 62's browser walk is carried by whichever of 077 and 074 merges second**
(Code Owner, 2026-10-03). The case is written `(browser, admin project)` and its walk opens
the filtered picker from the group panel's Add-column control, so it needs 077's column view
and 074's group panel on `main` together and can be written by neither lane alone: at the
merge base there is no group in the admin's draft model at all. The case's substance - the
picker offers only the five allowed types, says why the others are absent, and names the
stacked presentation as the alternative - is asserted in the admin's jsdom layer here
(`table-column-view.test.tsx`, `picker-selection.test.ts`), and the second lane to land adds
the walk on its rebase. It is an **exit criterion of that lane** rather than a note, so it
cannot fall between the two.

**Two as-built details worth stating, both inside the deliverables rather than beside them.**
A column's help text is drawn **once, on the column header**, and clipped in the cells with
the label: it is identical down a column, so a three-row table would otherwise repeat it
three times, and each input keeps its own `aria-describedby` either way. And **nothing in the table is pinned at all**, which is
the withdrawn deliverable above read forward: the row-header column is not pinned
inline-start either, and that is the same criterion once more. Pinning the first column is
the obvious thing to want on a wide table in a horizontal scroll box, and it is the one pin
this layout could actually support, which is exactly why it is refused: a focused cell the
browser scrolls under a pinned first column IS obscured, and discharging that needs
`scroll-padding-inline-start` equal to that column's width, which nothing in CSS knows.

**The 3.3.2 inference is recorded rather than asserted.** H44 says a hidden label satisfies 1.3.1 and 4.1.2 but that for 3.3.2 "the label element must be visible", and no W3C source found states that a visible `<th>` column header discharges 3.3.2 for the input in the cell beneath it. The plan takes that as an inference and names task **030**'s manual screen-reader pass as where it is tested. Do not upgrade the inference to a claim in this task's documentation.
