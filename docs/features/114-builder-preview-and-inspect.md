# 114 - Builder preview and inspect

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin`, `@roonga/qcms-ui` (the field wrapper in `registry.tsx` only) · **Depends on:** 113, 111, 109; the preview toolbar on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (U2, U3, Q3, review findings) · ADR-22 · ADR-38 · `plan/work-order-sequence.md`

## Context

The preview is the inline ADR-38 island with container-query breakpoints; no iframe (Q3). It renders the draft as a respondent would see it, including the draft's appearance (109). Inspect lets the user point at a question and build 111's selection fact for it.

## Deliverables

- U2:
  - Preview pane: device presets, a width-by-height readout, rotate, zoom, light and dark polarity and high contrast, Reset answers.
  - The draft's appearance applied to the island; the environment default where the draft has none.
  - The portal's chrome around the step: the header's brand mark and step indicator, and the step rail or its narrow fold, by the appearance's progress mode.
  - The layout collector: measures in the browser and builds 111's layout fact, held for the next builder turn; no API route.
- U3:
  - Inspect mode: hover and select a question in the preview; the selection is built as 111's selection fact and held for the next builder turn.
  - `data-qcms-question-id` on the qcms-owned field wrapper (`FieldBlur` in `packages/ui/src/registry.tsx`), never on vendored files (ADR-22).
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none.

- Preview output equals the portal's rendering of the same draft at the same width, appearance included.

## Required tests

- Playwright (X3): device switch and rotate change the container breakpoint; polarity and high contrast toggles; Reset answers clears the preview; inspect selects a question and the fact carries only its id; the header and the rail or its fold follow the progress mode and the frame width; axe clean in light, dark and high contrast.
- Vitest: the layout fact and selection fact pass 111's strict schemas; the wrapper attribute is present and absent from vendored files.

## Files and areas

`apps/admin/components/forms/` (preview pane, new), `apps/admin/components/preview-theme-island.tsx`, `apps/admin/lib/{preview-theme,measure}.ts`, `apps/admin/lib/forms/preview-views.ts`, `packages/ui/src/registry.tsx`, `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: the preview toolbar and inspect states on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Accepted simplifications

Code Owner, round-1 review of PR #1359:

- The builder builds and holds both facts; sending them with assist requests is issue #1363.
- The preview pages itself, so the rail's completed rows and question entries are buttons that move the preview, not the portal's links, and the rail's resume point is the shown step.
- The respondent's own appearance menu in the portal header is not shown; the preview toolbar sets polarity and high contrast.
- The header shows the deployment's brand (`QCMS_PORTAL_BRAND_NAME`, and `QCMS_PORTAL_BRAND_LOGO` when it is a `data:` image). A root-relative logo is a portal path the admin origin cannot load.
- The draft's own logo is not shown: the admin has no read path to the logo store. Tracked in #1365.

## Out of scope

Editing appearance (116). Edits and Undo (115). Sending the builder facts (issue #1363).
