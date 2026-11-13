# 114 - Builder preview and inspect

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin`, `@roonga/qcms-ui` (`form-field.tsx` only) · **Depends on:** 113, 111, 109; the preview toolbar on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (U2, U3, Q3, review findings) · ADR-22 · ADR-38 · `plan/work-order-sequence.md`

## Context

The preview is the inline ADR-38 island with container-query breakpoints; no iframe (Q3). It renders the draft as a respondent would see it, including the draft's appearance (109). Inspect lets the user point at a question and tell the assistant about it through 111's selection fact.

## Deliverables

- U2:
  - Preview pane: device presets, a width-by-height readout, rotate, zoom, light and dark polarity and high contrast, Reset answers.
  - The draft's appearance applied to the island; the environment default where the draft has none.
  - The layout collector: measures in the browser and sends 111's layout fact; no API route.
- U3:
  - Inspect mode: hover and select a question in the preview; the selection is sent as 111's selection fact.
  - `data-qcms-question-id` on the qcms-owned wrapper in `packages/ui/src/form-field.tsx`, never on vendored files (ADR-22).
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none.

- Preview output equals the portal's rendering of the same draft at the same width, appearance included.

## Required tests

- Playwright (X3): device switch and rotate change the container breakpoint; polarity and high contrast toggles; Reset answers clears the preview; inspect selects a question and the fact carries only its id; axe clean in light, dark and high contrast.
- Vitest: the layout fact and selection fact pass 111's strict schemas; the wrapper attribute is present and absent from vendored files.

## Files and areas

`apps/admin/components/forms/` (preview pane, new), `apps/admin/components/preview-theme-island.tsx`, `apps/admin/lib/{preview-theme,measure}.ts`, `apps/admin/lib/forms/preview-views.ts`, `packages/ui/src/form-field.tsx`, `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: the preview toolbar and inspect states on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

Editing appearance (116). Edits and Undo (115).
