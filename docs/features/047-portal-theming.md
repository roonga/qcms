# 047 - Portal theming: managed themes + respondent controls (launch tier)

**Stage:** 7 (portal + `@qcms/ui`) · **Apps/packages:** `packages/ui` (028), `apps/portal` (029) · **Depends on:** 028, 029, **045** (the modern header hosts the respondent controls; 045 reworks the shell/flow)
**Runs:** after 045. **Launch tier per ADR-30** (predefined themes + per-deployment selection + respondent a11y controls + font registry); the admin save-custom-theme UI is **Phase-4** (issue #26). This is a large task and will likely **decompose into subtasks when scheduled** (token contract / respondent controls / font registry) - it exists now to log the requirements; implementation is deferred.
**References:** ADR-30 (this task implements it) · ADR-22/26 (superseded single-override; two-surface mandate) · ADR-11 (LocalizedText) · §3 font mandate (open-licensed + self-hostable, Google Fonts canonical) · WCAG 2.2 AA + 1.4.12 + 2.5.8 · the theme-palette design deliverable (`tokens.css` + showcase from the design pass) · issues #25 (brand mark), #26 (managed theming / Phase-4 admin UI), #27 (multi-script fallback), #28 (forced-colors/prefers-contrast).

## Context

ADR-30 replaces ADR-22's single-file token override for the portal with a **managed** model: an admin-set **theme** (palette + default font + radius + brand mark) and **respondent runtime controls** (mode / font / density), over a **four-group token contract** (color, typography, spacing, radius). The concrete predefined themes come from the design pass. This task builds the launch tier; the admin "save a named custom theme" UI is Phase-4.

## Deliverables

- **Token contract (`@qcms/ui`):** extend `theme.css` beyond `--color-*` to the four groups - typography (`--font-portal` + a type scale honoring the WCAG 1.4.12 floors: >=16px body, >=1.5 line-height, >=0.12em letter, >=0.16em word, >=2em paragraph), spacing (`--space-control-h` / `-control-pad-x` / `-field-gap` / `-section-pad` / `-stack`), radius (`--radius-control` / `-card` / `-sm`). Vendored components consume spacing + radius; document the contract.
- **Predefined themes:** ship the design pass's themes (Slate Teal default + brand-neutral alternates), each authored in **Light / Dark** per theme. **HC is a single mode-layer** (theme-agnostic scaffold + per-theme AAA accent), not a per-theme palette. Per-deployment theme selection via config.
- **Respondent runtime controls (portal header, post-045):** **mode** (L/D/HC), **font** (grouped registry select), **density** (Compact/Comfortable/Spacious icon toggle). Default from OS (`prefers-color-scheme` + `prefers-contrast: more`); persist the explicit choice (cookie/localStorage); **SSR-safe with no flash** (set the root class before first paint). Keyboard-operable, AA, selected states never color-only (must read in HC + for colour-blind).
- **Font registry (declarative):** a manifest where each font = family + self-hosted `woff2` + weights + fallback stack + license notice. Ship the groups (System always on / Accessibility: Atkinson Hyperlegible, Lexend, OpenDyslexic / Popular / Playful-Kids incl. Andika / Traditional-Corporate / Monospace: JetBrains Mono, Geist Mono, ...). All self-hosted (no CDN, CSP-safe); admin curates the respondent-facing subset (curation config for launch; full admin UI Phase-4). Adopter-extensible. Numeric inputs use tabular figures (`font-feature-settings: "tnum"`) regardless of font.
- **HC treatment:** the mode-layer carries CSS (heavy black borders, flat surfaces, heavy focus), applied via `.hc` in `@qcms/ui`, theme-agnostic.
- **Brand mark from config** (text + optional logo), replacing the hardcoded `QCMS` literal (folds #25).

## Exit criteria

1. All four token groups present in `theme.css`, documented; components consume spacing + radius; radius presets (Sharp/Subtle/Rounded/Pill) apply across controls + card + banners.
2. The predefined themes render, each in Light / Dark / HC, **all pairs meeting WCAG 2.2 AA (HC body -> AAA 7:1)**, axe-clean across flow states; per-deployment theme selection works.
3. Respondent **mode / font / density** controls work, persist, default from OS signals, and paint with **no flash** on SSR load; keyboard + AA; selected state not colour-only.
4. Fonts self-hosted and actually render; **zero external requests** (CSP-clean); registry add/remove verified as a one-entry manifest change; System always present.
5. WCAG floors hold across every font + density (incl. Compact); target size >= WCAG 2.5.8 minimum.
6. Brand mark driven by config (no `QCMS` source literal in the portal shell).
7. e2e covers theme + mode + font + density switching (extend the 045 portal e2e / its 3 viewports); no console errors.

## Out of scope

The **Phase-4** admin UI to customize a theme's tokens and save a **named custom theme** (issue #26); per-form theming; the full admin font-curation UI (config-only for launch). The two **baseline** items ship on their own tracks regardless of this feature: multi-script font fallback (#27) and forced-colors / prefers-contrast (#28) - reference them, do not absorb them here.
