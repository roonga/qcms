# 051 - Theming subtask A: token contract, predefined themes, HC layer

**Stage:** 7 · **Package:** `packages/ui` (plus per-deployment selection config in `apps/portal`) · **Depends on:** 028, 029, 045
**Parent:** 047 (decomposed 2026-07-27; this subtask runs first - 052 and 053 both build on the contract)
**References:** ADR-30 · WCAG 2.2 AA + 1.4.12 · the theme-palette design deliverable (`tokens.css` + showcase) · `plan/theme-palettes/`

## Context

First slice of 047: the four-group token contract the whole theming model rests on, the predefined themes over it, and the single HC mode layer. No respondent-facing UI in this subtask - selection is config-only here so the themes are exercisable end to end before 053 adds controls.

## Deliverables

- **Token contract in `theme.css`:** extend beyond `--color-*` to typography (`--font-portal` + a type scale honoring the WCAG 1.4.12 floors: >=16px body, >=1.5 line-height, >=0.12em letter, >=0.16em word, >=2em paragraph), spacing (`--space-control-h` / `-control-pad-x` / `-field-gap` / `-section-pad` / `-stack`), radius (`--radius-control` / `-card` / `-sm`). Vendored components consume spacing + radius. Document the contract.
- **Radius presets** (Sharp/Subtle/Rounded/Pill) applying across controls + card + banners.
- **Predefined themes** from the design pass (Slate Teal default + brand-neutral alternates), each authored Light / Dark.
- **HC as a single mode layer:** theme-agnostic scaffold (heavy black borders, flat surfaces, heavy focus) applied via `.hc` in `@roonga/qcms-ui`, plus per-theme AAA accent - never a per-theme palette.
- **Per-deployment theme selection via config** (no UI; the admin editor is 049).

## Exit criteria

1. All four token groups present in `theme.css` and documented; components consume spacing + radius; radius presets apply across controls + card + banners. (047 EC 1)
2. The predefined themes render, each in Light / Dark / HC, all pairs meeting WCAG 2.2 AA (HC body AAA 7:1), axe-clean across flow states; per-deployment selection works via config. (047 EC 2)

## Out of scope

The font registry and font-dependent floors (052), respondent controls and persistence (053), the admin theme editor (049), baselines #27/#28.
