# QCMS portal theming: the token contract

**Status:** implements ADR-30's launch tier, first slice (task 051).
**Owns:** the four-group token contract, the four predefined themes, the corner
presets, the single High-contrast mode layer, and per-deployment selection.
**Does not own (yet):** the declarative font registry (task 052), the respondent
mode / font / density controls and their persistence (task 053), the admin theme
editor (task 049), multi-script font fallback (issue #27), forced-colors /
`prefers-contrast` (issue #28).

## Ownership in one paragraph

Portal presentation splits into two layers. A **theme** is operator-set: a
palette, a default font, a corner preset and (later) a brand mark. **Respondent
runtime choices** are mode, font and density. A theme is **mutable operator
config, not form-grade immutable content** - it is chrome, not answer data, so
none of the immutability, determinism or auditability guarantees touch it. In this
slice there is no respondent-facing selector at all: selection is configuration.

## The four token groups

Everything the portal renders resolves from a CSS custom property declared in
`packages/ui/src/theme.css`. There are exactly four groups, and nothing outside
them is a styling decision the portal is allowed to make.

| Group | Tokens | Varies with |
| --- | --- | --- |
| 1. Colour | `--color-*` (36 tokens) | theme x mode |
| 2. Typography | `--font-portal`, `--type-*` | font selection (052) |
| 3. Spacing | `--space-control-h` `--space-control-pad-x` `--space-field-gap` `--space-section-pad` `--space-stack` | density (053) |
| 4. Radius | `--radius-control` `--radius-card` `--radius-sm` | corner preset |

### Selector convention

| Axis | Carrier | Values |
| --- | --- | --- |
| Mode | root class | (none) = Light, `.dark`, `.hc` |
| Theme | root attribute | (absent) or `[data-theme="slate"]` = default, `harbor`, `sand`, `plum` |
| Corners | root class | (none) = Subtle, `.radius-sharp`, `.radius-rounded`, `.radius-pill` |

The default theme lives in the bare `:root` blocks, so setting `data-theme` is
enough to switch and removing it restores the default. The `.hc` blocks are
emitted **after** every light/dark block: that source order is load-bearing,
because `:root.hc` and `:root[data-theme="x"]` have the same specificity.

### Group 2: the WCAG 1.4.12 floors are numeric requirements

| Floor | Token | Value |
| --- | --- | --- |
| Body text >= 16px | `--type-body`, `--type-label` | `1rem` |
| Hint text >= 14px | `--type-hint` | `0.875rem` |
| Line-height >= 1.5 | `--type-line-height` | `1.5` |
| Letter-spacing >= 0.12em | `--type-letter-spacing` | `0.12em` |
| Word-spacing >= 0.16em | `--type-word-spacing` | `0.16em` |
| Paragraph spacing >= 2em | `--type-paragraph-spacing` | `2em` |

Plus `--type-step-title` (`clamp(1.55rem, 3.5vw, 1.85rem)`),
`--type-section-title` and `--type-title-line-height` for headings. No mode, theme
or (later) density level may lower a floor;
`packages/ui/src/theme-tokens.test.ts` asserts each one and asserts that every
theme x mode resolution leaves it unchanged.

### Group 4: the corner presets

| Token | Sharp | Subtle (default) | Rounded | Pill | Applies to |
| --- | --- | --- | --- | --- | --- |
| `--radius-control` | 0 | 6px | 10px | 999px | inputs, textarea, date field, select trigger, buttons |
| `--radius-card` | 0 | 10px | 16px | 20px | step card, panels, banners, select popover |
| `--radius-sm` | 0 | 4px | 6px | 8px | checkbox indicator, date segments, options |

Geometry only, so no contrast ratio depends on this group.

## How the vendored components consume spacing and radius

The `packages/ui/src/components/a2ui/*` sources are **vendored upstream and kept
byte-for-byte** so `a2ra diff` stays clean (ADR-22). Their Tailwind strings
already resolve `--color-*` themselves, but their spacing, radius and font sizes
are literal utilities (`px-3`, `rounded`, `text-sm`). Reaching those through the
token contract therefore happens in one qcms-owned stylesheet,
`packages/ui/src/theme-components.css`, and **never** by editing a vendored file.

It uses two mechanisms:

1. A Tailwind v4 `@theme` block repoints the two sub-16px steps of the type scale
   (`--text-sm`, `--text-xs`) at the QCMS type tokens. Those two steps are what
   the vendored labels, descriptions and error slots use, and they are 14px / 12px
   by default: below the 1.4.12 floors. Fixing the scale fixes every one of them
   from the tokens.
2. Plain **unlayered** CSS rules for radius and spacing. Tailwind's utilities live
   in `@layer utilities`, and unlayered author CSS beats any layer regardless of
   specificity, so these win over `rounded` / `px-3` without `!important` and
   without depending on Tailwind internals.

The selectors anchor only on markup qcms or react-aria owns: `[data-qcms-field]`
(the per-question wrapper `registry.tsx` renders) and `[data-rac]` (a
react-aria-components element).

Consuming both files:

```css
@import "tailwindcss";
@import "@qcms/ui/theme.css"; /* the token values */
@import "@qcms/ui/theme-components.css"; /* the components consume them */
```

`theme.css` alone is valid plain CSS and can be imported by a non-Tailwind host
for the token values; `theme-components.css` needs Tailwind v4 in the build (the
components need it anyway).

## The four predefined themes

Colour values come from the theme-palette design deliverable
(`plan/theme-palettes/`: `THEMES.md` documents every pair, `tokens.css` holds the
authored values) and are copied into `theme.css` verbatim, never re-derived.

| Key | Name | Character |
| --- | --- | --- |
| `slate` | Slate Teal | the shipped default: muted blue-green over cool slate neutrals |
| `harbor` | Harbor | calm corporate blue; info shares the primary hue |
| `sand` | Sand | warm neutral with a muted terracotta primary |
| `plum` | Plum | deep violet; info stays blue to remain distinct |

Each is authored in **Light and Dark**. Semantic colours stay in their
conventional lanes (danger red, success green, warning amber) so meaning is never
carried by hue alone.

### Measured contrast

`theme-tokens.test.ts` recomputes every critical pair from `theme.css` with the
WCAG 2.2 sRGB relative-luminance formula, so these numbers cannot drift from the
shipped values. Targets: 4.5:1 body text and 3:1 UI in Light and Dark, **7:1 body
text** in High-contrast. The worst pair in each combination:

| Theme / mode | Worst text pair | Target | Worst UI pair | Target |
| --- | --- | --- | --- | --- |
| slate / light | 5.91:1 (danger-fg / danger) | 4.5 | 3.26:1 (border-strong / background) | 3 |
| slate / dark | 6.78:1 (text-muted / surface) | 4.5 | 3.33:1 (border-strong / surface) | 3 |
| slate / hc | 9.75:1 (danger-fg / danger) | 7 | 9.26:1 (focus-ring / background) | 3 |
| harbor / light | 5.91:1 (danger-fg / danger) | 4.5 | 3.74:1 (border-strong / background) | 3 |
| harbor / dark | 6.72:1 (text-muted / surface) | 4.5 | 3.25:1 (border-strong / surface) | 3 |
| harbor / hc | 9.75:1 (danger-fg / danger) | 7 | 9.26:1 (focus-ring / background) | 3 |
| sand / light | 5.73:1 (primary-fg / primary) | 4.5 | 3.55:1 (border-strong / background) | 3 |
| sand / dark | 7.02:1 (primary-fg / primary) | 4.5 | 3.26:1 (border-strong / surface) | 3 |
| sand / hc | 8.80:1 (primary-fg / primary) | 7 | 8.80:1 (primary / surface) | 3 |
| plum / light | 5.91:1 (danger-fg / danger) | 4.5 | 3.88:1 (border-strong / background) | 3 |
| plum / dark | 6.34:1 (text-muted / surface) | 4.5 | 3.33:1 (border-strong / surface) | 3 |
| plum / hc | 9.75:1 (danger-fg / danger) | 7 | 9.26:1 (focus-ring / background) | 3 |

## High-contrast is ONE mode layer, not a palette per theme

This is the part that is easiest to get wrong. High-contrast is **not** a third
palette authored per theme. It is a single, theme-agnostic layer:

- **Token values** (`:root.hc` in `theme.css`): pure `#000` text and borders on
  `#fff` surfaces, one muted text, the fixed AAA semantic colours, one universal
  focus ring `#0a3ea8`.
- **CSS treatment** (`:root.hc` in `theme-components.css`): 2px borders at
  `--color-border-strong` on every control edge, flat surfaces (every Tailwind
  shadow utility neutralized), a 3px focus outline, separators at full contrast,
  and `color-scheme: light` (High-contrast is a distinct choice, not Dark).
- **A theme contributes only its accent**: `--color-primary` plus hover / active /
  foreground, via a four-token `:root[data-theme="x"].hc` block. Links and primary
  UI pick it up, so each theme keeps a whisper of brand.

| Theme | HC accent | primary-fg / primary |
| --- | --- | --- |
| slate | `#0b453d` (in the base `:root.hc`) | 10.85:1 |
| harbor | `#0a3a8a` | 10.57:1 |
| sand | `#7a3717` | 8.80:1 |
| plum | `#54148f` | 11.20:1 |

**A new theme gets High-contrast for free** by adding one AAA-safe accent block.
`theme-tokens.test.ts` enforces the shape: every theme must resolve to the
identical HC palette apart from those four accent tokens, and an alternate theme's
`.hc` block may not declare anything else.

## Per-deployment selection (config only in this slice)

QCMS is single-tenant (ADR-20), so one deployment runs one theme. The portal reads
it from the environment in `apps/portal/lib/server/theme.ts` and `app/layout.tsx`
stamps it onto `<html>` during SSR.

| Variable | Values (default first) | Effect |
| --- | --- | --- |
| `QCMS_PORTAL_THEME` | `slate` `harbor` `sand` `plum` | `data-theme` attribute |
| `QCMS_PORTAL_CORNERS` | `subtle` `sharp` `rounded` `pill` | corners root class |
| `QCMS_PORTAL_MODE` | `auto` `light` `dark` `hc` | first-paint mode class |

An unrecognized value falls back to the default rather than throwing: a typo in
presentation config must not take a deployment down, and the fallback is always
the safe brand-neutral default. `QCMS_PORTAL_MODE=hc` is how a deployment ships
High-contrast as its default.

A pre-paint inline script (nonced, SEC-9) resolves the mode before first paint, so
there is no flash: `?mode=light|dark|hc` wins, then the `qcms-theme` cookie, then
the configured default, then the OS `prefers-color-scheme`. The URL parameter and
the cookie are the manual door until task 053 adds the respondent switcher; that
task also adds defaulting from `prefers-contrast: more`.

Deployment-specific values that no predefined theme offers go in the single
documented override file, `apps/portal/app/adopter-theme.css` - never
`globals.css`, never a component. Overrides there sit outside the token test's
gate, so a deployment that changes colours checks its own pairs.

## Adding a theme

1. Author Light and Dark palettes (all 36 `--color-*` tokens) in the design
   deliverable, `plan/theme-palettes/`, and let `build.py` verify the pairs.
2. Copy the two blocks into `packages/ui/src/theme.css` as
   `:root[data-theme="<key>"]` and `:root[data-theme="<key>"].dark`, placed with
   the other alternates and **before** the High-contrast section.
3. Add one `:root[data-theme="<key>"].hc` block with the four accent tokens only,
   using an accent that clears 7:1 behind white.
4. Add the key to `PORTAL_THEMES` in `apps/portal/lib/server/theme.ts` and to
   `THEMES` in `packages/ui/src/theme-tokens.test.ts` and
   `apps/portal/e2e/theming.pw.ts`.
5. Run `pnpm --filter @qcms/ui test` (the ratios and the HC shape) and
   `pnpm verify:browser` (axe in all three modes).

## Where the evidence lives

| Claim | Test |
| --- | --- |
| Every pair meets its WCAG target, in every theme x mode | `packages/ui/src/theme-tokens.test.ts` (computed from `theme.css`) |
| Each 1.4.12 floor is a token and no mode lowers it | same file |
| HC is one layer plus a per-theme accent | same file |
| Selection resolves from config, including the typo path | `apps/portal/lib/server/theme.test.ts` |
| Config reaches `<html>` and the computed style | `apps/portal/e2e/theming.pw.ts` |
| The corner presets change controls, card and banner | same spec |
| The vendored controls really consume the spacing tokens | same spec (moves each token and re-measures) |
| The floors hold on rendered text | same spec |
| Every theme is axe-clean in Light, Dark and HC | same spec |
| HC really is heavy borders, flat surfaces, heavy focus | same spec |
