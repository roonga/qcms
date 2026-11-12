# 120 - Portal respondent menu and text size

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/portal`, `@roonga/qcms-ui` (root scale) · **Depends on:** 118; the respondent menu on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (P3, P4, Q6, Q9) · ADR-30 · `docs/portal-constraints.md` · `docs/theming.md` · `plan/work-order-sequence.md`

## Context

Respondent controls: display mode, high contrast, text size and a legibility face override (System, Atkinson Hyperlegible, OpenDyslexic, Lexend, all in the font registry). Density stays admin-only. `POST /appearance` stays for no-JS.

## Deliverables

- P3: the respondent menu with the legibility face override, over the form's appearance; choices kept in the existing cookies; `POST /appearance` kept and extended for the face and text size.
- P4: the text-size scale: a root multiplier of 100, 125, 150 or 200 percent over the admin base (16 to 24 px); the product capped at 32 px; reflow proven at 320 px.
- Strings in `apps/portal/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none.

- Every combination of admin base and respondent scale stays within 32 px and reflows at 320 px.

## Required tests

- Vitest: the multiplier and cap over every base and scale pair.
- Playwright portal (X2): the respondent menu with and without JS; each face applies; reflow at 320 px at the largest product; axe in light, dark and high contrast with the menu open.

## Files and areas

`apps/portal/components/{appearance-controls,appearance-context}.tsx`, `apps/portal/app/appearance/route.ts`, `apps/portal/lib/appearance.ts`, `apps/portal/lib/server/appearance-form.ts`, `packages/ui/src/{theme.css,font-registry.ts}`, `apps/portal/lib/i18n/en.ts`, `apps/portal/e2e/`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: the respondent menu and the largest text size at 320 px on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

Adding faces to the registry (separate registry PRs, Q11). Admin density.
