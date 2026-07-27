# 052 - Theming subtask B: declarative font registry

**Stage:** 7 · **Packages:** `packages/ui` + `apps/portal` · **Depends on:** 051
**Parent:** 047 (decomposed 2026-07-27; runs after 051 - the registry populates the contract's typography group; 053's font control selects from it)
**References:** ADR-30 · §3 font mandate (open-licensed + self-hostable, Google Fonts canonical) · WCAG 1.4.12

## Context

Second slice of 047: the font registry as data, self-hosting, and the licensing/fallback discipline - everything about fonts except the respondent control that picks one (053).

## Deliverables

- **Declarative manifest:** each font = family + self-hosted `woff2` + weights + fallback stack + license notice. Adopter-extensible; one-entry add/remove.
- **Shipped groups:** System (always on) / Accessibility (Atkinson Hyperlegible, Lexend, OpenDyslexic) / Popular / Playful-Kids (incl. Andika) / Traditional-Corporate / Monospace (JetBrains Mono, Geist Mono, ...).
- **All self-hosted** - no CDN, CSP-safe, zero external requests.
- **Curation config:** the admin curates the respondent-facing subset via config for launch (full admin UI is Phase-4).
- **Tabular figures:** numeric inputs use `font-feature-settings: "tnum"` regardless of font.

## Exit criteria

1. Fonts self-hosted and actually render; zero external requests (CSP-clean); registry add/remove verified as a one-entry manifest change; System always present. (047 EC 4)
2. WCAG 1.4.12 floors hold across every shipped font at default density (the density interaction completes in 053). (047 EC 5, font half)

## Out of scope

The respondent font-select control and persistence (053), multi-script fallback baseline (#27 - reference, do not absorb), the admin curation UI (Phase-4).
