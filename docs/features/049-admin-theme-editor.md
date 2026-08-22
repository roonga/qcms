# 049 - Admin theme editor: customize tokens and save named custom themes

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · `@qcms/ui` (token contract consumer) · **Depends on:** 038 (launch validation), 031 (admin shell), 047 (token contract + predefined themes)
**References:** ADR-30 · ADR-22/26 · WCAG 2.2 AA · issue #26

## Context

Launch ships predefined themes, per-deployment selection, and respondent appearance controls. This Phase 4 task adds persistence, runtime emission, and an admin editor for named custom themes. Themes remain mutable operator config, not form-grade immutable content.

## Deliverables

- **Theme editor screen** in `apps/admin`: start-from-theme picker; grouped token editing per the four-group contract; live preview against representative portal content; WCAG contrast checks inline (AA minimum enforced for the semantic color pairs, with the HC mode contribution limited to the accent per ADR-30).
- **Save as named custom theme:** name + persistence in the deployment's config store; appears in the per-deployment theme selection alongside predefined themes; edit and delete for custom themes (predefined themes immutable - customizing one forks it).
- **Validation:** a saved theme must satisfy the full token contract (no missing groups) and the AA contrast floor; rejects are inline and actionable.
- **HC interaction per ADR-30:** custom themes contribute only the AAA-deep accent to HC mode; the editor communicates this rather than offering HC-palette editing.

## Exit criteria

1. Create-customize-save-select round trip proven in Playwright against a real portal render using the saved theme.
2. Contrast floor enforced: a failing pair blocks save with an inline explanation (test).
3. Predefined themes remain immutable; forking is the only edit path (test).
4. axe and responsive browser checks pass for the editor and its live preview.
5. `pnpm verify` + `verify:browser` green.

## Out of scope (binding)

Per-form theming; font-manifest editing (the registry stays config); HC palette editing; theme import/export; multi-tenant theme libraries (single-tenant per ADR-20).
