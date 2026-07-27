# 053 - Theming subtask C: respondent runtime controls + brand mark

**Stage:** 7 · **App:** `apps/portal` (045's header hosts the controls) · **Depends on:** 051, 052, 045
**Parent:** 047 (decomposed 2026-07-27; final slice - closes 047 and its ledger row)
**References:** ADR-30 · ADR-27 · WCAG 2.2 AA + 2.5.8 · issue #25 (brand mark; folded here)

## Context

Third slice of 047: the respondent-facing surface - mode / font / density controls in the portal header, their persistence and SSR-safety, and the brand mark from config. This is the UI slice, so the static-render screenshot gate applies.

## Deliverables

- **Mode control** (Light/Dark/HC), **font control** (grouped select over 052's curated registry), **density control** (Compact/Comfortable/Spacious icon toggle) in the post-045 header.
- **Defaults from OS signals** (`prefers-color-scheme`, `prefers-contrast: more`); explicit choice persisted (cookie/localStorage); **SSR-safe with no flash** (root class set before first paint).
- Keyboard-operable, AA; selected states never colour-only (must read in HC and for colour-blind users).
- **Brand mark from config** (text + optional logo), replacing the hardcoded `QCMS` literal (folds #25).

## Exit criteria

1. Mode / font / density controls work, persist, default from OS signals, and paint with no flash on SSR load; keyboard + AA; selected state not colour-only. (047 EC 3)
2. WCAG floors hold across every font + density incl. Compact; target size >= WCAG 2.5.8 minimum. (047 EC 5, density half)
3. Brand mark driven by config; no `QCMS` source literal in the portal shell. (047 EC 6)
4. e2e covers theme + mode + font + density switching (extend the 045 portal e2e / its 3 viewports); no console errors or warnings (the #147 gate applies). (047 EC 7)

## Out of scope

Admin theme editor (049), per-form theming, forced-colors baseline (#28 - reference, do not absorb).
