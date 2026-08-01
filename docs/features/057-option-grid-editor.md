# 057 - Option grid: inline-editable table for choice options

**Stage:** 8a · **Apps/packages:** `apps/admin` (the question editor's option surface only) · **Depends on:** 048 (it rewrites the same editor files; landing 057 first would hand 048 a moving seam).
**External input required:** the frozen design card `plan/admin-theme/ds-option-grid.html`, **approved by the Code Owner** - do not start while the card is still iterating (the design-churn rule, retro 032). The card is the contract; if it and this file disagree, the card wins and the discrepancy is reported.
**References:** the card above · `plan/admin-theme/ds-table.html` (the grid's parent visual language) and `ds-inputs.html` (focus/error language) · `apps/admin/components/questions/option-list-editor.tsx` (the component being replaced, and the invariants it encodes) · ADR-27 (i18n: all chrome via the catalog) · issue #224 (stale-closure constraint updates - do not reintroduce the pattern while rewriting state flow) · Code Owner direction 2026-08-01 ("make the options editor feel more like the confluence table").

## Context

Task 032 shipped the options editor as stacked form fields - correct, but heavy for what is fundamentally tabular authoring. The Code Owner wants the Confluence-table feel: rows in a grid, the cell IS the input (borderless in-place editing), a ghost add-row, hover-revealed row controls, drag-to-reorder. The design card translates that feel into this design system's industrial character (40px rows, hairlines, sharp corners, tokens only).

## Deliverables

- **Replace the option list's presentation** with the card's grid: header row, drag-handle gutter, editable Label cell (in-place: table text at rest, focus ring and surface fill when editing), read-only ID cell (text, never an input - the minted-once invariant survives structurally, exactly as `option-list-editor.tsx` encodes it today), hover-revealed drag handle and remove that are **also focus-revealed** (keyboard parity) and always visible in HC.
- **Ghost add-row** ("+ Add option"): appends and focuses the new row's Label cell.
- **Insert between/before/after rows (Code Owner addition, 2026-08-01):** pointer path - hovering a row boundary (including above the first and below the last) reveals the card's insert point (accent line + circled "+"); clicking inserts an empty row there and focuses its Label cell. Keyboard parity path per the card (a row-level insert action reachable from the handle - Insert above / Insert below - never pointer-only), with accessible names naming the row ("Insert option above <label>"). New options minted the same way as append: the id is minted at insert, never editable.
- **Reordering is full drag and drop (Code Owner addition, 2026-08-01):** rows draggable by the handle with a live drop-indicator line marking the target position, plus the keyboard path (Arrow Up/Down with the handle focused) - both driving the existing `moveOption` semantics.
- **Keyboard rhythm per the card:** Tab cell-to-cell, Enter commits and moves to the next row's Label (on the last row and the ghost row: adds), Escape reverts the in-flight cell edit.
- **Error state:** empty/invalid label renders the card's cell-error treatment with the message line; the editor's existing validation flow (048's message plumbing included, since 048 lands first) is presentation-rehoused, not changed.
- **State discipline:** the underlying `definition.ts` helpers (`addOption`/`moveOption`/`relabelOption`/`removeOption`) remain the only mutators; this is a presentation-layer rebuild. Mind #224's stale-closure pattern when batching cell commits.
- **i18n:** every new string (ghost row, control names, error line) through the catalog (ADR-27).

## Exit criteria

1. Visual conformance to the frozen card, proven by the screenshot set: rest grid, row hover with revealed controls, an editing cell, the error row, the ghost row - at 390 and 1280 in light/dark/HC (`docs/gates/057/`, README naming what to approve; human gate).
2. The optionId invariant is structurally intact: no input is bound to an id (assert the existing test still passes unchanged, or extend it to the new markup).
3. Keyboard: the full rhythm above proven in a Playwright walk (including reorder AND insert-above/below via keyboard, and that hover-revealed controls and insert points appear on focus without a pointer); axe green in all three modes with a cell in its editing state.
4. Reordering by real drag (drop-indicator position respected) and by keyboard both persist through save and survive a reload; an insert at top, between two rows, and at bottom each lands in the right position and persists (e2e).
5. No behavior change to option semantics: relabel/add/remove/reorder produce identical wire payloads to the pre-rebuild editor (regression-compare the action calls or API bodies).
6. `pnpm verify` + `pnpm verify:browser` green; no new dependencies (drag implemented with the existing stack - if a drag library seems needed, stop and surface it, do not add one silently).

## Out of scope (binding)

Any change to option semantics, ids, or wire shapes; the rest of the question editor's layout (048 owns its current shape); tables elsewhere in the admin (the responses table etc. keep ds-table as-is); multi-select/bulk row operations; new dependencies.
