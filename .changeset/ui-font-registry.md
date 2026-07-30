---
"@qcms/ui": minor
---

Add the declarative, entirely self-hosted font registry that populates the
typography group of the token contract (task 052, ADR-30).

`src/font-registry.ts` is the manifest and the only place a font is added or
removed: 22 open-licensed families across five groups (Accessibility, Popular,
Playful & Kids, Traditional & Corporate, Monospace) plus a System entry that
downloads nothing and can never be curated away. Each entry carries its family,
self-hosted weights, a fallback stack ending in a CSS generic, and its upstream
copyright notice.

The `woff2` binaries are **committed** under `src/fonts/` (750,664 bytes, 24 files,
Latin subsets) rather than fetched at build time, so a deployment and its CI never
depend on a third-party font host and a portal makes zero external requests for a
typeface. `src/fonts.css` and `src/fonts/NOTICE.md` are generated from the manifest
by `pnpm --filter @qcms/ui fonts:generate` and a drift test fails if either has
gone stale. The OFL-1.1 and Apache-2.0 texts ship beside the binaries.

New exports: the `./fonts.css` stylesheet subpath, and a `./fonts` module
subpath exporting `FONT_REGISTRY`, `FONT_GROUPS`, `SYSTEM_FONT_KEY`, `fontByKey`,
`fontChoices`, `fontClass`, `renderFontsCss` and the `FontEntry` / `FontFace` /
`FontGroup` / `FontLicense` types.

`theme.css` gains `--type-numeric` (`"tnum"`) and `theme-components.css` applies it
to numeric controls, so digits are tabular in every font. A registry entry sets
`--font-portal` and nothing else, which is what keeps the WCAG 1.4.12 floors out of
reach of a font selection.
