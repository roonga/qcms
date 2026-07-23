# QCMS respondent portal - predefined theme palettes

Design deliverable for managed theming (issue #26) and the respondent mode switcher.

Four brand-neutral themes. **Light and Dark are per-theme palettes; High-contrast is a single shared, theme-agnostic mode-layer** (documented once below) - a theme contributes only its accent to HC. Every colour value below is defined in `tokens.css`; every contrast ratio is computed from those exact values with the WCAG 2.2 relative-luminance formula (sRGB, `(L1+0.05)/(L2+0.05)`) by `build.py`, so the numbers cannot drift from the tokens.

## Targets

| Mode | Body text | Large / secondary text | UI / borders / focus |
|---|---|---|---|
| Light | 4.5:1 (AA) | 3:1 | 3:1 |
| Dark | 4.5:1 (AA) | 3:1 | 3:1 |
| High-contrast | **7:1 (AAA)** | 4.5:1 | 3:1 |

## Typography

- `--font-portal` default: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

- **Font is a respondent runtime control** (a grouped `<select>` in the header, next to the colour-mode and density switchers). This models the three-layer registry: **the registry ships many fonts grouped by purpose; the admin curates which are offered; System default is always on** as the accessibility escape hatch so a respondent is never trapped in a shipped face.
- Switching overrides `--font-portal` via a root class (`:root.font-<key>`). Every font below is **embedded in `showcase.html` as a base64 `woff2` data URI** (fetched at build time by `fetch_fonts.py`), so the page renders each for real with **no runtime network request** (CSP-safe). In production, self-host the same `woff2` via `@font-face`.

| Group | Font | Weights | Licence | Build source |
|---|---|---|---|---|
| System | System default (OS stack) | - | n/a | not embedded (device font) |
| Accessibility | Atkinson Hyperlegible - designed for low vision | 400+700 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Accessibility | Lexend - tuned for reading proficiency | 400+700 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Accessibility | OpenDyslexic - weighted letterforms for dyslexia | 400+700 | OFL-1.1 | antijingoist/opendyslexic (official OFL) |
| Popular | Inter | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Popular | Roboto | 400 | Apache-2.0 | fonts.gstatic.com (Google Fonts) |
| Popular | Open Sans | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Popular | Lato | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Popular | Poppins | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Popular | Montserrat | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Playful & Kids | Andika - SIL, early-reader literacy | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Playful & Kids | Fredoka - rounded, friendly | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Playful & Kids | Baloo 2 - chunky, playful | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Playful & Kids | Comic Neue - open Comic-Sans alternative | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Playful & Kids | Patrick Hand - casual handwriting | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Traditional & Corporate | Merriweather - professional serif | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Traditional & Corporate | Lora - balanced serif | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Traditional & Corporate | PT Serif - traditional serif | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Traditional & Corporate | Libre Baskerville - formal Baskerville serif | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Traditional & Corporate | IBM Plex Serif - corporate serif | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |
| Traditional & Corporate | Public Sans - US gov design-system neutral sans | 400 | OFL-1.1 | fonts.gstatic.com (Google Fonts) |

- **All 20 web fonts fetched and embedded successfully** (Accessibility group carries regular + bold; Popular / Playful / Traditional carry regular only to bound file size). Total embedded payload is large by design for this showcase.

- Serif families fall back to `Georgia, "Times New Roman", serif`; the rest to `ui-sans-serif, system-ui, sans-serif`. Accessibility faces have distinct `I` / `l` / `1` and non-mirrored `b` / `d`.
- **The WCAG 1.4.12 type-scale floors below apply to whichever font is selected** - the sample sets them on the content region, so no embedded face can drop below them:
- **Type-scale floors (WCAG 1.4.12, applied to the sample and mandated for the portal):**
  - Body text >= **16px** (input text never smaller).
  - Line-height >= **1.5**.
  - Letter-spacing >= **0.12em**.
  - Word-spacing >= **0.16em**.
  - Paragraph spacing >= **2em**.
  - Step heading ~1.75-1.875rem; labels 1rem; hint text 0.875rem (>=14px), never the sole carrier of meaning.

## Density (spacing axis)

- A **fourth respondent runtime control** (in the header alongside colour-mode and font), modelled on Outlook / Gmail density: **Compact / Comfortable (default) / Spacious**. It is independent of theme x mode x font and composes freely with them.
- Implemented as a named spacing-token group swapped by a root class (`.density-compact` / `.density-spacious`; Comfortable = base `:root`) - the same mechanism as mode and font. The sample's form consumes these tokens, so switching visibly re-spaces it.

| Token | Comfortable (base) | Compact | Spacious | Used for |
|---|---|---|---|---|
| `--space-control-h` | 44px | 36px | 52px | input / button / select height |
| `--space-control-pad-x` | 0.9rem | 0.6rem | 1.1rem | horizontal padding in controls |
| `--space-field-gap` | 2em | 1.3em | 2.5em | gap between questions |
| `--space-section-pad` | 2.25rem | 1.5rem | 2.9rem | step-card padding |
| `--space-stack` | 0.5rem | 0.35rem | 0.7rem | label-to-input gap / option padding |

- **Density changes CHROME spacing only** - padding, gaps, control heights, rhythm. **Hard constraints hold in every level, including Compact:**
  - Body text stays >= **16px**, line-height >= **1.5**, letter-spacing >= **0.12em**, word-spacing >= **0.16em** (the WCAG 1.4.12 floors above are never altered by density).
  - Interactive targets stay >= **24px** (WCAG 2.5.8): `--space-control-h` bottoms out at **36px** in Compact (still comfortably above 24px, and Comfortable/Spacious sit at ~44px+ for touch). Option rows, being text + padding, exceed this at every level.
- Contrast is unaffected - spacing tokens carry no colour, so all ratios below are identical across the three densities.

## Corners (border-radius) - theme-level

- Unlike mode / font / density (respondent runtime controls), **Corners is a theme / admin-level setting** - it sets brand character, so the showcase groups it with the theme selector ('Corners'), not with the respondent controls in the header.
- A `--radius-*` token group swapped by a root class (`.radius-sharp` / `.radius-rounded` / `.radius-pill`; **Subtle = base `:root`**). It **composes with theme x mode x font x density** and is applied across inputs, buttons, selects, option rows, the step card, and banners, so switching visibly re-rounds the whole sample. **No contrast impact** (geometry only).

| Token | Sharp | Subtle (default) | Rounded | Pill | Used for |
|---|---|---|---|---|---|
| `--radius-control` | 0 | 6px | 10px | 999px | buttons / inputs / selects |
| `--radius-card` | 0 | 10px | 16px | 20px | step card / panels / banners |
| `--radius-sm` | 0 | 4px | 6px | 8px | checkboxes / radios / chips |

---

## slate - Slate Teal (shipped default)

Slate Teal is the shipped QCMS default: a muted blue-green primary over cool slate neutrals, professional and brand-neutral so adopters can re-skin cleanly. Light and dark are the production values, carried unchanged. High-contrast is designed here: near-black text on white, neutrals flattened, the teal accent deepened to a forest tone (#0b453d) that still clears AAA behind white button text.

### slate / light

Light mode: every text/background pair meets WCAG 2.2 AA (>=4.5:1 body, >=3:1 large/UI).

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#0f1729` | `#fbfcfd` | 17.40 | 4.5 | PASS |
| text / surface | `#0f1729` | `#ffffff` | 17.87 | 4.5 | PASS |
| text-muted / background | `#55617a` | `#fbfcfd` | 6.05 | 4.5 | PASS |
| text-muted / surface | `#55617a` | `#ffffff` | 6.22 | 4.5 | PASS |
| primary-fg / primary | `#ffffff` | `#2c6e63` | 5.97 | 4.5 | PASS |
| secondary-fg / secondary | `#ffffff` | `#4f5b70` | 6.86 | 4.5 | PASS |
| danger-fg-btn / danger | `#ffffff` | `#c0271f` | 5.91 | 4.5 | PASS |
| danger-fg / danger-subtle | `#8f1d18` | `#f9e7e5` | 7.46 | 4.5 | PASS |
| info-fg / info-subtle | `#1b44a0` | `#e9effb` | 7.65 | 4.5 | PASS |
| success-fg / success-subtle | `#16603a` | `#e4f1ea` | 6.53 | 4.5 | PASS |
| warning-fg / warning-subtle | `#6e4700` | `#f6eeda` | 7.08 | 4.5 | PASS |
| border-strong / surface | `#838ca4` | `#ffffff` | 3.36 | 3.0 | PASS |
| border-strong / background | `#838ca4` | `#fbfcfd` | 3.27 | 3.0 | PASS |
| focus-ring / background | `#2456c6` | `#fbfcfd` | 6.35 | 3.0 | PASS |
| focus-ring / surface | `#2456c6` | `#ffffff` | 6.52 | 3.0 | PASS |
| primary / surface (link/UI) | `#2c6e63` | `#ffffff` | 5.97 | 3.0 | PASS |

<details><summary>Full token values (slate / light)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#2c6e63` |
| `--color-primary-hover` | `#245a51` |
| `--color-primary-active` | `#1e4a43` |
| `--color-primary-foreground` | `#ffffff` |
| `--color-secondary` | `#4f5b70` |
| `--color-secondary-hover` | `#475265` |
| `--color-secondary-active` | `#3f495a` |
| `--color-secondary-foreground` | `#ffffff` |
| `--color-danger` | `#c0271f` |
| `--color-danger-hover` | `#ad231c` |
| `--color-danger-active` | `#9a1f19` |
| `--color-danger-foreground` | `#ffffff` |
| `--color-danger-subtle` | `#f9e7e5` |
| `--color-danger-fg` | `#8f1d18` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#eef1f6` |
| `--color-ghost-active` | `#e4e8ef` |
| `--color-info` | `#2456c6` |
| `--color-info-subtle` | `#e9effb` |
| `--color-info-fg` | `#1b44a0` |
| `--color-success` | `#1e7a46` |
| `--color-success-subtle` | `#e4f1ea` |
| `--color-success-fg` | `#16603a` |
| `--color-warning` | `#8a5a00` |
| `--color-warning-subtle` | `#f6eeda` |
| `--color-warning-fg` | `#6e4700` |
| `--color-text` | `#0f1729` |
| `--color-text-muted` | `#55617a` |
| `--color-border` | `#dde2ea` |
| `--color-border-strong` | `#838ca4` |
| `--color-background` | `#fbfcfd` |
| `--color-background-muted` | `#eef1f6` |
| `--color-surface` | `#ffffff` |
| `--color-surface-hover` | `#f4f6fa` |
| `--color-focus-ring` | `#2456c6` |
| `--color-overlay` | `rgb(0 0 0 / 0.5)` |
| `--font-portal` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |

</details>

### slate / dark

Dark mode: inverted neutrals, accents lightened and desaturated so they stay >=4.5:1 on the dark surface; button foregrounds flip to near-black. Meets AA.

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#e6eaf2` | `#0b0f1a` | 15.87 | 4.5 | PASS |
| text / surface | `#e6eaf2` | `#141a26` | 14.45 | 4.5 | PASS |
| text-muted / background | `#97a2b8` | `#0b0f1a` | 7.45 | 4.5 | PASS |
| text-muted / surface | `#97a2b8` | `#141a26` | 6.78 | 4.5 | PASS |
| primary-fg / primary | `#0b0f1a` | `#5fb8ac` | 8.14 | 4.5 | PASS |
| secondary-fg / secondary | `#0b0f1a` | `#97a2b8` | 7.45 | 4.5 | PASS |
| danger-fg-btn / danger | `#0b0f1a` | `#ff7b80` | 7.65 | 4.5 | PASS |
| danger-fg / danger-subtle | `#ffb3b5` | `#2b1615` | 10.07 | 4.5 | PASS |
| info-fg / info-subtle | `#a9c4ff` | `#16233a` | 9.00 | 4.5 | PASS |
| success-fg / success-subtle | `#8fe0bd` | `#132a20` | 9.83 | 4.5 | PASS |
| warning-fg / warning-subtle | `#f0cd85` | `#2a2110` | 10.41 | 4.5 | PASS |
| border-strong / surface | `#626c88` | `#141a26` | 3.33 | 3.0 | PASS |
| border-strong / background | `#626c88` | `#0b0f1a` | 3.66 | 3.0 | PASS |
| focus-ring / background | `#7aa2ff` | `#0b0f1a` | 7.69 | 3.0 | PASS |
| focus-ring / surface | `#7aa2ff` | `#141a26` | 7.00 | 3.0 | PASS |
| primary / surface (link/UI) | `#5fb8ac` | `#141a26` | 7.41 | 3.0 | PASS |

<details><summary>Full token values (slate / dark)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#5fb8ac` |
| `--color-primary-hover` | `#72c1b6` |
| `--color-primary-active` | `#82c8be` |
| `--color-primary-foreground` | `#0b0f1a` |
| `--color-secondary` | `#97a2b8` |
| `--color-secondary-hover` | `#a3adc1` |
| `--color-secondary-active` | `#aeb6c8` |
| `--color-secondary-foreground` | `#0b0f1a` |
| `--color-danger` | `#ff7b80` |
| `--color-danger-hover` | `#ff8b8f` |
| `--color-danger-active` | `#ff989c` |
| `--color-danger-foreground` | `#0b0f1a` |
| `--color-danger-subtle` | `#2b1615` |
| `--color-danger-fg` | `#ffb3b5` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#1b2230` |
| `--color-ghost-active` | `#232c3c` |
| `--color-info` | `#7aa2ff` |
| `--color-info-subtle` | `#16233a` |
| `--color-info-fg` | `#a9c4ff` |
| `--color-success` | `#46c08a` |
| `--color-success-subtle` | `#132a20` |
| `--color-success-fg` | `#8fe0bd` |
| `--color-warning` | `#e0a93b` |
| `--color-warning-subtle` | `#2a2110` |
| `--color-warning-fg` | `#f0cd85` |
| `--color-text` | `#e6eaf2` |
| `--color-text-muted` | `#97a2b8` |
| `--color-border` | `#262e3d` |
| `--color-border-strong` | `#626c88` |
| `--color-background` | `#0b0f1a` |
| `--color-background-muted` | `#10151f` |
| `--color-surface` | `#141a26` |
| `--color-surface-hover` | `#1b2230` |
| `--color-focus-ring` | `#7aa2ff` |
| `--color-overlay` | `rgb(0 0 0 / 0.6)` |

</details>

HC for this theme = the shared High-contrast mode-layer below, with only its accent swapped to `#0b453d`.

---

## harbor - Harbor (corporate blue)

Harbor is a calm corporate blue. The primary is a confident mid-blue (#1f5eb8) and info reuses the same hue so links and info banners read as one family. Neutrals are shifted cool (a faint blue cast in text/border/background) to harmonise with the accent. Danger/success/warning stay in their conventional red/green/amber lanes so meaning is never carried by hue alone.

### harbor / light

Light mode: every text/background pair meets WCAG 2.2 AA (>=4.5:1 body, >=3:1 large/UI).

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#0e1626` | `#e8eef6` | 15.49 | 4.5 | PASS |
| text / surface | `#0e1626` | `#f4f8fd` | 16.96 | 4.5 | PASS |
| text-muted / background | `#495777` | `#e8eef6` | 6.18 | 4.5 | PASS |
| text-muted / surface | `#495777` | `#f4f8fd` | 6.76 | 4.5 | PASS |
| primary-fg / primary | `#ffffff` | `#1f5eb8` | 6.27 | 4.5 | PASS |
| secondary-fg / secondary | `#ffffff` | `#4a5a75` | 6.98 | 4.5 | PASS |
| danger-fg-btn / danger | `#ffffff` | `#c0271f` | 5.91 | 4.5 | PASS |
| danger-fg / danger-subtle | `#8f1d18` | `#f9e7e5` | 7.46 | 4.5 | PASS |
| info-fg / info-subtle | `#184a94` | `#e8f0fb` | 7.48 | 4.5 | PASS |
| success-fg / success-subtle | `#16603a` | `#e4f1ea` | 6.53 | 4.5 | PASS |
| warning-fg / warning-subtle | `#6e4700` | `#f6eeda` | 7.08 | 4.5 | PASS |
| border-strong / surface | `#6b7996` | `#f4f8fd` | 4.10 | 3.0 | PASS |
| border-strong / background | `#6b7996` | `#e8eef6` | 3.75 | 3.0 | PASS |
| focus-ring / background | `#1f5eb8` | `#e8eef6` | 5.37 | 3.0 | PASS |
| focus-ring / surface | `#1f5eb8` | `#f4f8fd` | 5.88 | 3.0 | PASS |
| primary / surface (link/UI) | `#1f5eb8` | `#f4f8fd` | 5.88 | 3.0 | PASS |

<details><summary>Full token values (harbor / light)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#1f5eb8` |
| `--color-primary-hover` | `#1c55a6` |
| `--color-primary-active` | `#194b93` |
| `--color-primary-foreground` | `#ffffff` |
| `--color-secondary` | `#4a5a75` |
| `--color-secondary-hover` | `#435169` |
| `--color-secondary-active` | `#3b485e` |
| `--color-secondary-foreground` | `#ffffff` |
| `--color-danger` | `#c0271f` |
| `--color-danger-hover` | `#ad231c` |
| `--color-danger-active` | `#9a1f19` |
| `--color-danger-foreground` | `#ffffff` |
| `--color-danger-subtle` | `#f9e7e5` |
| `--color-danger-fg` | `#8f1d18` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#dce5f1` |
| `--color-ghost-active` | `#d0dcec` |
| `--color-info` | `#1f5eb8` |
| `--color-info-subtle` | `#e8f0fb` |
| `--color-info-fg` | `#184a94` |
| `--color-success` | `#1e7a46` |
| `--color-success-subtle` | `#e4f1ea` |
| `--color-success-fg` | `#16603a` |
| `--color-warning` | `#8a5a00` |
| `--color-warning-subtle` | `#f6eeda` |
| `--color-warning-fg` | `#6e4700` |
| `--color-text` | `#0e1626` |
| `--color-text-muted` | `#495777` |
| `--color-border` | `#c8d4e7` |
| `--color-border-strong` | `#6b7996` |
| `--color-background` | `#e8eef6` |
| `--color-background-muted` | `#dce5f1` |
| `--color-surface` | `#f4f8fd` |
| `--color-surface-hover` | `#e8eff8` |
| `--color-focus-ring` | `#1f5eb8` |
| `--color-overlay` | `rgb(0 0 0 / 0.5)` |
| `--font-portal` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |

</details>

### harbor / dark

Dark mode: inverted neutrals, accents lightened and desaturated so they stay >=4.5:1 on the dark surface; button foregrounds flip to near-black. Meets AA.

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#e6ecf6` | `#08111f` | 15.94 | 4.5 | PASS |
| text / surface | `#e6ecf6` | `#111c2e` | 14.39 | 4.5 | PASS |
| text-muted / background | `#96a3bd` | `#08111f` | 7.45 | 4.5 | PASS |
| text-muted / surface | `#96a3bd` | `#111c2e` | 6.73 | 4.5 | PASS |
| primary-fg / primary | `#08111f` | `#6fa8ff` | 7.85 | 4.5 | PASS |
| secondary-fg / secondary | `#08111f` | `#96a3bd` | 7.45 | 4.5 | PASS |
| danger-fg-btn / danger | `#08111f` | `#ff7b80` | 7.56 | 4.5 | PASS |
| danger-fg / danger-subtle | `#ffb3b5` | `#2b1615` | 10.07 | 4.5 | PASS |
| info-fg / info-subtle | `#a9c8ff` | `#152238` | 9.40 | 4.5 | PASS |
| success-fg / success-subtle | `#8fe0bd` | `#122a1f` | 9.85 | 4.5 | PASS |
| warning-fg / warning-subtle | `#f0cd85` | `#2a2010` | 10.50 | 4.5 | PASS |
| border-strong / surface | `#606c88` | `#111c2e` | 3.25 | 3.0 | PASS |
| border-strong / background | `#606c88` | `#08111f` | 3.60 | 3.0 | PASS |
| focus-ring / background | `#6fa8ff` | `#08111f` | 7.85 | 3.0 | PASS |
| focus-ring / surface | `#6fa8ff` | `#111c2e` | 7.09 | 3.0 | PASS |
| primary / surface (link/UI) | `#6fa8ff` | `#111c2e` | 7.09 | 3.0 | PASS |

<details><summary>Full token values (harbor / dark)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#6fa8ff` |
| `--color-primary-hover` | `#80b2ff` |
| `--color-primary-active` | `#8fbbff` |
| `--color-primary-foreground` | `#08111f` |
| `--color-secondary` | `#96a3bd` |
| `--color-secondary-hover` | `#a3aec5` |
| `--color-secondary-active` | `#adb7cc` |
| `--color-secondary-foreground` | `#08111f` |
| `--color-danger` | `#ff7b80` |
| `--color-danger-hover` | `#ff8b8f` |
| `--color-danger-active` | `#ff989c` |
| `--color-danger-foreground` | `#08111f` |
| `--color-danger-subtle` | `#2b1615` |
| `--color-danger-fg` | `#ffb3b5` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#18243a` |
| `--color-ghost-active` | `#1f2c46` |
| `--color-info` | `#6fa8ff` |
| `--color-info-subtle` | `#152238` |
| `--color-info-fg` | `#a9c8ff` |
| `--color-success` | `#46c08a` |
| `--color-success-subtle` | `#122a1f` |
| `--color-success-fg` | `#8fe0bd` |
| `--color-warning` | `#e0a93b` |
| `--color-warning-subtle` | `#2a2010` |
| `--color-warning-fg` | `#f0cd85` |
| `--color-text` | `#e6ecf6` |
| `--color-text-muted` | `#96a3bd` |
| `--color-border` | `#242d3e` |
| `--color-border-strong` | `#606c88` |
| `--color-background` | `#08111f` |
| `--color-background-muted` | `#0d1626` |
| `--color-surface` | `#111c2e` |
| `--color-surface-hover` | `#18243a` |
| `--color-focus-ring` | `#6fa8ff` |
| `--color-overlay` | `rgb(0 0 0 / 0.6)` |

</details>

HC for this theme = the shared High-contrast mode-layer below, with only its accent swapped to `#0a3a8a`.

---

## sand - Sand (warm neutral / terracotta)

Sand is a warm neutral: warm greys (a faint brown cast) with a muted terracotta primary (#a24e2c light). It reads editorial and low-glare. Info stays blue and success green for semantic recognisability, but their subtle backgrounds are nudged warm to sit in the palette. The terracotta is darkened for AAA in high-contrast.

### sand / light

Light mode: every text/background pair meets WCAG 2.2 AA (>=4.5:1 body, >=3:1 large/UI).

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#231a12` | `#f7f1e6` | 15.21 | 4.5 | PASS |
| text / surface | `#231a12` | `#fdf9f1` | 16.28 | 4.5 | PASS |
| text-muted / background | `#655847` | `#f7f1e6` | 6.14 | 4.5 | PASS |
| text-muted / surface | `#655847` | `#fdf9f1` | 6.58 | 4.5 | PASS |
| primary-fg / primary | `#ffffff` | `#a24e2c` | 5.73 | 4.5 | PASS |
| secondary-fg / secondary | `#ffffff` | `#6d6152` | 6.03 | 4.5 | PASS |
| danger-fg-btn / danger | `#ffffff` | `#bb2a20` | 6.06 | 4.5 | PASS |
| danger-fg / danger-subtle | `#8c1f18` | `#f8e7e3` | 7.54 | 4.5 | PASS |
| info-fg / info-subtle | `#1b44a0` | `#eaeffb` | 7.66 | 4.5 | PASS |
| success-fg / success-subtle | `#16603a` | `#e6f1e8` | 6.54 | 4.5 | PASS |
| warning-fg / warning-subtle | `#6e4700` | `#f7edd6` | 7.03 | 4.5 | PASS |
| border-strong / surface | `#8d7d66` | `#fdf9f1` | 3.80 | 3.0 | PASS |
| border-strong / background | `#8d7d66` | `#f7f1e6` | 3.55 | 3.0 | PASS |
| focus-ring / background | `#2456c6` | `#f7f1e6` | 5.80 | 3.0 | PASS |
| focus-ring / surface | `#2456c6` | `#fdf9f1` | 6.21 | 3.0 | PASS |
| primary / surface (link/UI) | `#a24e2c` | `#fdf9f1` | 5.46 | 3.0 | PASS |

<details><summary>Full token values (sand / light)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#a24e2c` |
| `--color-primary-hover` | `#924628` |
| `--color-primary-active` | `#823e23` |
| `--color-primary-foreground` | `#ffffff` |
| `--color-secondary` | `#6d6152` |
| `--color-secondary-hover` | `#62574a` |
| `--color-secondary-active` | `#574e42` |
| `--color-secondary-foreground` | `#ffffff` |
| `--color-danger` | `#bb2a20` |
| `--color-danger-hover` | `#a8261d` |
| `--color-danger-active` | `#96221a` |
| `--color-danger-foreground` | `#ffffff` |
| `--color-danger-subtle` | `#f8e7e3` |
| `--color-danger-fg` | `#8c1f18` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#efe5d4` |
| `--color-ghost-active` | `#e7dcc7` |
| `--color-info` | `#2456c6` |
| `--color-info-subtle` | `#eaeffb` |
| `--color-info-fg` | `#1b44a0` |
| `--color-success` | `#1e7a46` |
| `--color-success-subtle` | `#e6f1e8` |
| `--color-success-fg` | `#16603a` |
| `--color-warning` | `#8a5a00` |
| `--color-warning-subtle` | `#f7edd6` |
| `--color-warning-fg` | `#6e4700` |
| `--color-text` | `#231a12` |
| `--color-text-muted` | `#655847` |
| `--color-border` | `#ddd0ba` |
| `--color-border-strong` | `#8d7d66` |
| `--color-background` | `#f7f1e6` |
| `--color-background-muted` | `#efe5d4` |
| `--color-surface` | `#fdf9f1` |
| `--color-surface-hover` | `#f2eadd` |
| `--color-focus-ring` | `#2456c6` |
| `--color-overlay` | `rgb(0 0 0 / 0.5)` |
| `--font-portal` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |

</details>

### sand / dark

Dark mode: inverted neutrals, accents lightened and desaturated so they stay >=4.5:1 on the dark surface; button foregrounds flip to near-black. Meets AA.

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#f0e9df` | `#17120c` | 15.45 | 4.5 | PASS |
| text / surface | `#f0e9df` | `#241d15` | 13.81 | 4.5 | PASS |
| text-muted / background | `#b6a894` | `#17120c` | 7.99 | 4.5 | PASS |
| text-muted / surface | `#b6a894` | `#241d15` | 7.15 | 4.5 | PASS |
| primary-fg / primary | `#1a120b` | `#e08a5f` | 7.02 | 4.5 | PASS |
| secondary-fg / secondary | `#1a120b` | `#b6a894` | 7.94 | 4.5 | PASS |
| danger-fg-btn / danger | `#1a120b` | `#ff7b80` | 7.40 | 4.5 | PASS |
| danger-fg / danger-subtle | `#ffb3b5` | `#2c1613` | 10.04 | 4.5 | PASS |
| info-fg / info-subtle | `#a9c4ff` | `#17233a` | 8.99 | 4.5 | PASS |
| success-fg / success-subtle | `#8fe0bd` | `#13291d` | 9.96 | 4.5 | PASS |
| warning-fg / warning-subtle | `#f0cd85` | `#2b2110` | 10.38 | 4.5 | PASS |
| border-strong / surface | `#7a6c58` | `#241d15` | 3.26 | 3.0 | PASS |
| border-strong / background | `#7a6c58` | `#17120c` | 3.65 | 3.0 | PASS |
| focus-ring / background | `#e08a5f` | `#17120c` | 7.06 | 3.0 | PASS |
| focus-ring / surface | `#e08a5f` | `#241d15` | 6.32 | 3.0 | PASS |
| primary / surface (link/UI) | `#e08a5f` | `#241d15` | 6.32 | 3.0 | PASS |

<details><summary>Full token values (sand / dark)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#e08a5f` |
| `--color-primary-hover` | `#e49872` |
| `--color-primary-active` | `#e7a482` |
| `--color-primary-foreground` | `#1a120b` |
| `--color-secondary` | `#b6a894` |
| `--color-secondary-hover` | `#bfb2a1` |
| `--color-secondary-active` | `#c6bbac` |
| `--color-secondary-foreground` | `#1a120b` |
| `--color-danger` | `#ff7b80` |
| `--color-danger-hover` | `#ff8b8f` |
| `--color-danger-active` | `#ff989c` |
| `--color-danger-foreground` | `#1a120b` |
| `--color-danger-subtle` | `#2c1613` |
| `--color-danger-fg` | `#ffb3b5` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#2d251b` |
| `--color-ghost-active` | `#382e22` |
| `--color-info` | `#7aa2ff` |
| `--color-info-subtle` | `#17233a` |
| `--color-info-fg` | `#a9c4ff` |
| `--color-success` | `#46c08a` |
| `--color-success-subtle` | `#13291d` |
| `--color-success-fg` | `#8fe0bd` |
| `--color-warning` | `#e0a93b` |
| `--color-warning-subtle` | `#2b2110` |
| `--color-warning-fg` | `#f0cd85` |
| `--color-text` | `#f0e9df` |
| `--color-text-muted` | `#b6a894` |
| `--color-border` | `#332a20` |
| `--color-border-strong` | `#7a6c58` |
| `--color-background` | `#17120c` |
| `--color-background-muted` | `#1e1811` |
| `--color-surface` | `#241d15` |
| `--color-surface-hover` | `#2d251b` |
| `--color-focus-ring` | `#e08a5f` |
| `--color-overlay` | `rgb(0 0 0 / 0.6)` |

</details>

HC for this theme = the shared High-contrast mode-layer below, with only its accent swapped to `#7a3717`.

---

## plum - Plum (deep violet)

Plum is a deep violet. The primary is a rich purple (#6d28a8 light) over cool violet-tinted neutrals. Info stays blue to remain distinct from the violet primary. In dark mode the primary lifts to a soft lilac (#c08cf0); in high-contrast it deepens to #54148f, kept only because it still clears AAA behind white button text.

### plum / light

Light mode: every text/background pair meets WCAG 2.2 AA (>=4.5:1 body, >=3:1 large/UI).

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#1a1226` | `#f2ecf9` | 15.66 | 4.5 | PASS |
| text / surface | `#1a1226` | `#faf6fe` | 16.99 | 4.5 | PASS |
| text-muted / background | `#584c6a` | `#f2ecf9` | 6.83 | 4.5 | PASS |
| text-muted / surface | `#584c6a` | `#faf6fe` | 7.41 | 4.5 | PASS |
| primary-fg / primary | `#ffffff` | `#6d28a8` | 8.34 | 4.5 | PASS |
| secondary-fg / secondary | `#ffffff` | `#5f5470` | 7.03 | 4.5 | PASS |
| danger-fg-btn / danger | `#ffffff` | `#c0271f` | 5.91 | 4.5 | PASS |
| danger-fg / danger-subtle | `#8f1d18` | `#f9e7e5` | 7.46 | 4.5 | PASS |
| info-fg / info-subtle | `#1b44a0` | `#eaeffb` | 7.66 | 4.5 | PASS |
| success-fg / success-subtle | `#16603a` | `#e5f1ea` | 6.54 | 4.5 | PASS |
| warning-fg / warning-subtle | `#6e4700` | `#f6eeda` | 7.08 | 4.5 | PASS |
| border-strong / surface | `#7f7098` | `#faf6fe` | 4.21 | 3.0 | PASS |
| border-strong / background | `#7f7098` | `#f2ecf9` | 3.88 | 3.0 | PASS |
| focus-ring / background | `#6d28a8` | `#f2ecf9` | 7.20 | 3.0 | PASS |
| focus-ring / surface | `#6d28a8` | `#faf6fe` | 7.81 | 3.0 | PASS |
| primary / surface (link/UI) | `#6d28a8` | `#faf6fe` | 7.81 | 3.0 | PASS |

<details><summary>Full token values (plum / light)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#6d28a8` |
| `--color-primary-hover` | `#622497` |
| `--color-primary-active` | `#572086` |
| `--color-primary-foreground` | `#ffffff` |
| `--color-secondary` | `#5f5470` |
| `--color-secondary-hover` | `#564c65` |
| `--color-secondary-active` | `#4c435a` |
| `--color-secondary-foreground` | `#ffffff` |
| `--color-danger` | `#c0271f` |
| `--color-danger-hover` | `#ad231c` |
| `--color-danger-active` | `#9a1f19` |
| `--color-danger-foreground` | `#ffffff` |
| `--color-danger-subtle` | `#f9e7e5` |
| `--color-danger-fg` | `#8f1d18` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#e9def4` |
| `--color-ghost-active` | `#e0d3f0` |
| `--color-info` | `#2456c6` |
| `--color-info-subtle` | `#eaeffb` |
| `--color-info-fg` | `#1b44a0` |
| `--color-success` | `#1e7a46` |
| `--color-success-subtle` | `#e5f1ea` |
| `--color-success-fg` | `#16603a` |
| `--color-warning` | `#8a5a00` |
| `--color-warning-subtle` | `#f6eeda` |
| `--color-warning-fg` | `#6e4700` |
| `--color-text` | `#1a1226` |
| `--color-text-muted` | `#584c6a` |
| `--color-border` | `#ddd0ec` |
| `--color-border-strong` | `#7f7098` |
| `--color-background` | `#f2ecf9` |
| `--color-background-muted` | `#e9def4` |
| `--color-surface` | `#faf6fe` |
| `--color-surface-hover` | `#efe7fa` |
| `--color-focus-ring` | `#6d28a8` |
| `--color-overlay` | `rgb(0 0 0 / 0.5)` |
| `--font-portal` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |

</details>

### plum / dark

Dark mode: inverted neutrals, accents lightened and desaturated so they stay >=4.5:1 on the dark surface; button foregrounds flip to near-black. Meets AA.

**Critical contrast pairs**

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#ece6f4` | `#150a22` | 15.65 | 4.5 | PASS |
| text / surface | `#ece6f4` | `#22163a` | 13.82 | 4.5 | PASS |
| text-muted / background | `#a898bd` | `#150a22` | 7.18 | 4.5 | PASS |
| text-muted / surface | `#a898bd` | `#22163a` | 6.34 | 4.5 | PASS |
| primary-fg / primary | `#150a22` | `#c08cf0` | 7.51 | 4.5 | PASS |
| secondary-fg / secondary | `#150a22` | `#a898bd` | 7.18 | 4.5 | PASS |
| danger-fg-btn / danger | `#150a22` | `#ff7b80` | 7.64 | 4.5 | PASS |
| danger-fg / danger-subtle | `#ffb3b5` | `#2b1518` | 10.11 | 4.5 | PASS |
| info-fg / info-subtle | `#c9c1ff` | `#1f1a3a` | 9.91 | 4.5 | PASS |
| success-fg / success-subtle | `#8fe0bd` | `#132a20` | 9.83 | 4.5 | PASS |
| warning-fg / warning-subtle | `#f0cd85` | `#2a2110` | 10.41 | 4.5 | PASS |
| border-strong / surface | `#756891` | `#22163a` | 3.33 | 3.0 | PASS |
| border-strong / background | `#756891` | `#150a22` | 3.77 | 3.0 | PASS |
| focus-ring / background | `#c08cf0` | `#150a22` | 7.51 | 3.0 | PASS |
| focus-ring / surface | `#c08cf0` | `#22163a` | 6.63 | 3.0 | PASS |
| primary / surface (link/UI) | `#c08cf0` | `#22163a` | 6.63 | 3.0 | PASS |

<details><summary>Full token values (plum / dark)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#c08cf0` |
| `--color-primary-hover` | `#c89af2` |
| `--color-primary-active` | `#cea5f3` |
| `--color-primary-foreground` | `#150a22` |
| `--color-secondary` | `#a898bd` |
| `--color-secondary-hover` | `#b2a4c5` |
| `--color-secondary-active` | `#bbafcc` |
| `--color-secondary-foreground` | `#150a22` |
| `--color-danger` | `#ff7b80` |
| `--color-danger-hover` | `#ff8b8f` |
| `--color-danger-active` | `#ff989c` |
| `--color-danger-foreground` | `#150a22` |
| `--color-danger-subtle` | `#2b1518` |
| `--color-danger-fg` | `#ffb3b5` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#2a1d46` |
| `--color-ghost-active` | `#332553` |
| `--color-info` | `#a99cff` |
| `--color-info-subtle` | `#1f1a3a` |
| `--color-info-fg` | `#c9c1ff` |
| `--color-success` | `#46c08a` |
| `--color-success-subtle` | `#132a20` |
| `--color-success-fg` | `#8fe0bd` |
| `--color-warning` | `#e0a93b` |
| `--color-warning-subtle` | `#2a2110` |
| `--color-warning-fg` | `#f0cd85` |
| `--color-text` | `#ece6f4` |
| `--color-text-muted` | `#a898bd` |
| `--color-border` | `#2d2340` |
| `--color-border-strong` | `#756891` |
| `--color-background` | `#150a22` |
| `--color-background-muted` | `#1c1030` |
| `--color-surface` | `#22163a` |
| `--color-surface-hover` | `#2a1d46` |
| `--color-focus-ring` | `#c08cf0` |
| `--color-overlay` | `rgb(0 0 0 / 0.6)` |

</details>

HC for this theme = the shared High-contrast mode-layer below, with only its accent swapped to `#54148f`.

---

## High-contrast - universal mode-layer (all themes)

High-contrast is **not a per-theme palette**. One universal palette serves every theme: pure `#000` text and borders on pure `#fff` surfaces, one muted text, the fixed AAA semantic colours, and a universal focus ring `#0a3ea8`. It is defined once in `:root.hc`. A theme contributes **only its accent** (`--color-primary` + hover/active/foreground) via a tiny `:root[data-theme="x"].hc` override; links and primary UI use `--color-primary`, so each theme keeps a whisper of brand while everything else stays identical.

A **new theme gets HC for free** by supplying one AAA-safe accent override - no full HC palette to author or maintain.

High-contrast mode (a distinct respondent choice, NOT dark): body text targets AAA (>=7:1), large/secondary text >=4.5:1, separators use border-strong at full contrast, and the focus ring is a heavy saturated blue. Brand accent is kept only where it still clears AAA.

### Universal HC pairs (identical for every theme)

These pairs contain no theme accent, so they are the same in all four themes:

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---:|---:|:--:|
| text / background | `#000000` | `#ffffff` | 21.00 | 7.0 | PASS |
| text / surface | `#000000` | `#ffffff` | 21.00 | 7.0 | PASS |
| text-muted / background | `#22262e` | `#ffffff` | 15.17 | 7.0 | PASS |
| text-muted / surface | `#22262e` | `#ffffff` | 15.17 | 7.0 | PASS |
| secondary-fg / secondary | `#ffffff` | `#1c2433` | 15.56 | 7.0 | PASS |
| danger-fg-btn / danger | `#ffffff` | `#8a0f0a` | 9.75 | 7.0 | PASS |
| danger-fg / danger-subtle | `#6b0b07` | `#ffecea` | 11.00 | 7.0 | PASS |
| info-fg / info-subtle | `#08337d` | `#e6efff` | 10.20 | 7.0 | PASS |
| success-fg / success-subtle | `#064023` | `#e2f4e9` | 10.39 | 7.0 | PASS |
| warning-fg / warning-subtle | `#4a3000` | `#fbf0d6` | 10.82 | 7.0 | PASS |
| border-strong / surface | `#000000` | `#ffffff` | 21.00 | 3.0 | PASS |
| border-strong / background | `#000000` | `#ffffff` | 21.00 | 3.0 | PASS |
| focus-ring / background | `#0a3ea8` | `#ffffff` | 9.26 | 3.0 | PASS |
| focus-ring / surface | `#0a3ea8` | `#ffffff` | 9.26 | 3.0 | PASS |

### Per-theme accent in HC (the only thing that differs)

Each accent is checked against the universal white surface for **primary-fg on primary** (AAA body 7:1) and **primary as link/UI** (3:1). All four clear AAA behind white foreground.

| Theme | Selector | `--color-primary` | fg | primary-fg / primary (>=7) | primary / #fff surface (>=3) |
|---|---|---|---|---:|---:|
| slate | `:root.hc (default)` | `#0b453d` | `#ffffff` | 10.86 PASS | 10.86 PASS |
| harbor | `:root[data-theme="harbor"].hc` | `#0a3a8a` | `#ffffff` | 10.58 PASS | 10.58 PASS |
| sand | `:root[data-theme="sand"].hc` | `#7a3717` | `#ffffff` | 8.80 PASS | 8.80 PASS |
| plum | `:root[data-theme="plum"].hc` | `#54148f` | `#ffffff` | 11.21 PASS | 11.21 PASS |

<details><summary>Full universal HC token values (:root.hc)</summary>

| Token | Value |
|---|---|
| `--color-primary` | `#0b453d` |  <!-- slate default; overridden per theme -->
| `--color-primary-hover` | `#063730` |  <!-- slate default; overridden per theme -->
| `--color-primary-active` | `#032823` |  <!-- slate default; overridden per theme -->
| `--color-primary-foreground` | `#ffffff` |  <!-- slate default; overridden per theme -->
| `--color-secondary` | `#1c2433` |
| `--color-secondary-hover` | `#19202e` |
| `--color-secondary-active` | `#161d29` |
| `--color-secondary-foreground` | `#ffffff` |
| `--color-danger` | `#8a0f0a` |
| `--color-danger-hover` | `#7c0e09` |
| `--color-danger-active` | `#6e0c08` |
| `--color-danger-foreground` | `#ffffff` |
| `--color-danger-subtle` | `#ffecea` |
| `--color-danger-fg` | `#6b0b07` |
| `--color-ghost` | `transparent` |
| `--color-ghost-hover` | `#eceef1` |
| `--color-ghost-active` | `#dfe2e7` |
| `--color-info` | `#0a3ea8` |
| `--color-info-subtle` | `#e6efff` |
| `--color-info-fg` | `#08337d` |
| `--color-success` | `#0a5c30` |
| `--color-success-subtle` | `#e2f4e9` |
| `--color-success-fg` | `#064023` |
| `--color-warning` | `#5a3b00` |
| `--color-warning-subtle` | `#fbf0d6` |
| `--color-warning-fg` | `#4a3000` |
| `--color-text` | `#000000` |
| `--color-text-muted` | `#22262e` |
| `--color-border` | `#5a616e` |
| `--color-border-strong` | `#000000` |
| `--color-background` | `#ffffff` |
| `--color-background-muted` | `#f2f3f5` |
| `--color-surface` | `#ffffff` |
| `--color-surface-hover` | `#eceef1` |
| `--color-focus-ring` | `#0a3ea8` |
| `--color-overlay` | `rgb(0 0 0 / 0.7)` |

</details>

---
