# ADR-30 (draft requirements) - Portal theming, modes, and typography

Working capture of decisions settled with Ravi 2026-07-23. Draft the ADR from this once the Claude Design palette pass returns (it feeds the concrete theme set). Supersedes ADR-22's single-override model for the portal; extends ADR-26.

## Model (two axes, clear ownership)
- **Theme = admin/adopter setup.** A named token set: brand palette + default font + **border-radius** (`--radius-control` / `--radius-card` / `--radius-sm`; presets Sharp / Subtle (default) / Rounded / Pill - brand character, admin-level not respondent) + brand mark (text/logo, folds #25). QCMS ships predefined themes; the adopter picks/customizes.
- **Mode = respondent runtime choice.** Light / Dark / **High-contrast**. Defaults from OS `prefers-color-scheme` + `prefers-contrast: more`, then persists the user's explicit pick.
  - **Light + Dark are per-theme palettes** (the brand lives here).
  - **HC is a mode-LAYER, not a per-theme palette:** defined ONCE, theme-agnostic (pure black-on-white, heavy 2px black borders, flat surfaces, heavy focus, fixed AAA semantic colors); the theme contributes ONLY its accent (primary/link/focus, deepened to AAA >=7:1). New themes get HC automatically by supplying one AAA-safe accent. Consistent, predictable stark experience regardless of theme; aligns with forced-colors / Windows HCM (#28), which overrides color entirely. HC also carries CSS treatment (border-weight/flatness), not only token values - so it is a mode that ships a little CSS in `@qcms/ui`, not a pure palette swap.
- **Font = respondent runtime choice.** Defaults from the admin's theme default; **System font is ALWAYS offered** (accessibility escape hatch); persisted.
- **Density = respondent runtime choice.** Compact / Comfortable (default) / Spacious - like Outlook/Gmail. A spacing-token group (`--space-control-h`, `--space-control-pad-x`, `--space-field-gap`, `--space-section-pad`, `--space-stack`) swapped by a root class (`.density-compact` / `.density-spacious`). Accessibility both ways (Spacious = bigger targets/breathing room; Compact = fits more). HARD FLOOR: even Compact respects the WCAG 1.4.12 text-spacing floors and the 2.5.8 target-size minimum - density changes chrome spacing only, never text or touch minimums. Composes independently with theme x mode x font.

## Shipped font registry (curated by admin for respondents)
Three layers: the registry **ships** many; the **admin exposes** a curated subset to respondents; the **respondent picks** from that subset (+ System always on). Shipped set (all mandate-clean):
- **Accessibility/visibility:** Atkinson Hyperlegible (OFL), Lexend (OFL), OpenDyslexic (OFL-1.1, self-hosted - the documented non-GF exception).
- **Popular "usual suspects" (all Google Fonts):** Inter (OFL), Roboto (Apache-2.0), Open Sans (Apache-2.0), Lato (OFL), Poppins (OFL), Montserrat (OFL), Nunito (OFL), Source Sans 3 (OFL).
- **Playful / Kids (Google Fonts, OFL):** Andika (SIL, literacy/early-reader), Fredoka, Baloo 2, Comic Neue, Patrick Hand.
- **Traditional / Corporate (Google Fonts, OFL):** Merriweather, Lora, PT Serif, Libre Baskerville, IBM Plex Serif, Public Sans.
- **Monospace - numeric-heavy forms [NEXT PASS]:** JetBrains Mono (OFL), Geist Mono (OFL-1.1; self-host if not in GF), Roboto Mono (Apache), IBM Plex Mono (OFL), Source Code Pro (OFL). Aligned digits (tabular) help number-heavy forms; consider also enabling `font-feature-settings: "tnum"` for numeric inputs regardless of font.
- **System default** stack - always available, never removable.

Font picker groups (showcase `<optgroup>`s): System / Accessibility / Popular / Playful & Kids / Traditional & Corporate / **Monospace**.

## Everything is a registry (add/remove by manifest)
- **Font registry:** each font = a declarative entry (family, self-hosted woff2 asset(s), weights, fallback stack, license notice). Portal switcher + admin config render from it. Add a font = add entry + drop woff2; remove = delete entry. Adopter-extensible (adopter's own font = adopter's licensing responsibility; QCMS built-ins stay open/GF per the mandate).
- **Theme registry:** a theme is likewise a named token-set entry. Predefined themes + (Phase-4) saved custom themes are entries in the same shape.

## Font mandate (already in PROJECT_GOAL, commit 4de427f)
Every font QCMS offers must be **open-licensed + self-hostable** (OFL/Apache/equivalent; no proprietary/paid; no runtime CDN). **Google Fonts is the canonical source**; a font outside it is allowed if it meets the bar and its license is documented beside the asset (e.g. OpenDyslexic, OFL-1.1). Accessible-typography traits (x-height, distinct I/l/1, non-mirrored b/d, weight, i18n script coverage) + WCAG 1.4.12 floors (>=16px body, >=1.5 line-height, >=0.12em letter, >=0.16em word, >=2em paragraph).

## Typography axis
Theme carries family + fallback + a type scale (not a lone token). Default `--font-portal` = system stack. Multi-script fallback for i18n is BASELINE (see below).

## Predefined theme set (Claude Design authoring, in flight)
Slate Teal (existing default) + Harbor (corporate blue) + Sand (warm neutral) + Plum (deep violet), each in light/dark/HC, all AA (HC -> AAA). Plus a **modern slim navbar** (brand + mode switcher + progress bar; the current top nav is dated). Token convention: `:root` / `:root.dark` / `:root.hc` for the default; `[data-theme="harbor|sand|plum"]` + their `.dark`/`.hc` for alternates.

## Scope split
- **Launch:** predefined themes + per-deployment selection + brand config + the respondent mode/font switchers + the registry. Granularity = **per-deployment** (single-tenant, ADR-20). Storage = **mutable operator config**, NOT form-grade immutable (presentation chrome, not answer data; immutability/auditability of answers unaffected).
- **Phase-4:** admin UI to customize a predefined theme's tokens and **save a named custom theme** (needs the admin app, 031-035).

## Baseline carve-out (ships at launch REGARDLESS of the theming feature; already filed)
- **#27** multi-script font fallback (no tofu) - ADR-27 correctness.
- **#28** honor `prefers-contrast: more` + `forced-colors` (Windows HCM) - task 030 a11y.
These are non-negotiable a11y/i18n baseline; do NOT gate them behind managed theming.

## Related issues
#26 managed theming (parent), #25 hardcoded brand mark, #27 multi-script fallback, #28 forced-colors/prefers-contrast.
