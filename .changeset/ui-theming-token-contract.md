---
"@roonga/qcms-ui": minor
---

Ship the four-group theming token contract, the predefined themes, and the
High-contrast mode layer (task 051, ADR-30).

`theme.css` now carries all four token groups instead of `--color-*` alone:

- **colour** - four predefined themes (`slate` Slate Teal default, `harbor`,
  `sand`, `plum`), each authored Light and Dark, selected with `data-theme` on the
  root and a mode root class;
- **typography** - `--font-portal` plus a `--type-*` scale that carries the WCAG
  1.4.12 floors as token values (body `>= 16px`, line-height `>= 1.5`,
  letter-spacing `>= 0.12em`, word-spacing `>= 0.16em`, paragraph spacing
  `>= 2em`);
- **spacing** - `--space-control-h` / `-control-pad-x` / `-field-gap` /
  `-section-pad` / `-stack`;
- **radius** - `--radius-control` / `-card` / `-sm` with the four corner presets
  (Sharp / Subtle / Rounded / Pill) as root classes.

High-contrast is a single theme-agnostic mode layer, never a palette per theme: a
theme contributes only its AAA-safe accent, so a new theme gets High-contrast for
free.

New export `@roonga/qcms-ui/theme-components.css`: the qcms-owned CSS that makes the
vendored a2-react-aria controls consume the spacing, radius and type-scale tokens
(the vendored sources stay byte-for-byte upstream, ADR-22) and that carries the
High-contrast treatment which is CSS rather than token values (heavy black
borders, flat surfaces, heavy focus). Import it after `theme.css`.

Every critical contrast pair is recomputed from `theme.css` by
`theme-tokens.test.ts` and gated at AA for Light/Dark and AAA (7:1) for
High-contrast, so a palette edit cannot quietly regress accessibility. Contract
documentation: `docs/theming.md`.

Note for existing consumers: a few Slate hover / subtle token values now match the
design deliverable exactly (they had drifted by a shade), and the two smallest
Tailwind type steps (`text-sm`, `text-xs`) are repointed at the type tokens by
`theme-components.css` so no vendored label or hint renders below its WCAG floor.
