# 107 - Shared appearance module

**Stage:** 9 (Phase 4) · **Apps/packages:** `@roonga/qcms-core`, `@roonga/qcms-ui` (token test and shipped palettes) · **Depends on:** 106
**References:** `plan/agent-builder-decisions.md` (A1, Q4, Q5, Q9, Q11, "Consequences of the two non-default rulings") · ADR-30 · `docs/theming.md` · `plan/theme-palettes/` · `plan/work-order-sequence.md`

## Context

One pure module every later builder task uses: the API validates with it (109, 110), the admin renders and edits with it (114, 116), the portal's appearance comes out of it through serve-step (118). It has no DOM, no I/O and no React, so `apps/api`, which depends on `@roonga/qcms-core` and not on `@roonga/qcms-ui`, can import it.

## Deliverables

- `packages/core/src/appearance.ts`, exported from the package index:
  - The Zod `Appearance` schema: inline colour tokens with no theme reference, since a theme is copied by value (spec section 9), a logo reference into 108's immutable logo storage, registry face (or System), corners, density, admin text-size base (16 to 24 px, Q9), progress mode (side rail, top indicator, none; read by 119), page-background tint. Strict: unknown keys refused.
  - WCAG contrast: relative luminance and ratio, with thresholds 4.5 (text), 3 (non-text and large text) and 7 (high contrast).
  - Derivation from a seed (colours and face): a light palette, a dark palette and a full high-contrast palette per polarity at 7:1 (Q5), every text-on-page pair checked, the page tint included or the tint dropped (review finding).
  - A correction report: which tokens were moved to pass and from what to what, as data for 116 and 117 to word.
  - Face mapping: any face outside the registry maps to a registry face or System (Q11).
- High-contrast sets for the shipped palettes, and `packages/ui/src/theme-tokens.test.ts` changed so `.hc` may set the full token set, not four accent tokens (Q5).
- Appearance stays outside `FormDefinition`: no golden-corpus change.

## Exit criteria

Spec criteria owned: none.

- Every shipped palette passes the module's own contrast check in light, dark and both high-contrast variants.
- The module is the only contrast and derivation code in the repository; `packages/ui/src/theme-contrast.test.ts` uses it or is reconciled with it.

## Required tests

X1 (Vitest, in this task): contrast ratios against published WCAG reference pairs; derivation from seeds that fail (light yellow on white, mid grey) yields passing palettes and a correction report; high contrast reaches 7:1 on every text pair; the tint is in the check; the schema refuses unknown keys, out-of-range text size and a face outside the registry; property tests that any derived palette passes.

## Files and areas

`packages/core/src/appearance.ts` and `appearance.test.ts`, `packages/core/src/index.ts`, `packages/ui/src/theme-tokens.test.ts`, `packages/ui/src/theme-contrast.test.ts`, `packages/ui/src/theme.css`, `plan/theme-palettes/` (source for the shipped high-contrast sets).

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates). B because shipped palettes and `@roonga/qcms-ui` tokens change.

## Review

Opus first round; Sonnet delta.

## Design gate

None. Palette values follow the design system (106).

## Out of scope

Storage (108). Routes (109, 110). Any UI (114, 116, 118).
