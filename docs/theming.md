# QCMS portal theming: the token contract

**Status:** implements ADR-30's launch tier in full (tasks 051 + 052 + 053), with
the scope carrier added by task 060 (ADR-38).
**Owns:** the four-group token contract, the four predefined themes, the corner
presets, the single High-contrast mode layer, the three density levels,
per-deployment selection, the brand mark, the declarative self-hosted font registry
with its curation config, the shared font fallback tails (issue #27), and the
respondent mode / font / density controls with their persistence.
**Does not own:** the Phase 4 admin theme editor (task 049), the admin font-curation UI,
per-form theming, and self-hosted **multi-script** coverage (the open half of
issue #27: which non-Latin scripts QCMS ships faces for is undecided).
**Documented here but not part of this feature:** the automatic contrast
baseline - `prefers-contrast: more` and `forced-colors` / Windows High Contrast
Mode (issue #28). QCMS ships it regardless of managed theming, and it is written
up here because the rules it adds sit in the same two stylesheets and because
what a theme may and may not override under forced colours is a theming
question. Note the one part that IS this feature: defaulting the mode from
`prefers-contrast: more` is one line of the pre-paint script, below.

## Ownership in one paragraph

Portal presentation splits into two layers. A **theme** is operator-set: a
palette, a default font, a corner preset and the brand mark. **Respondent runtime
choices** are mode, font and density, and they sit on top of the theme rather than
replacing it. A theme is **mutable operator config, not form-grade immutable
content** - it is chrome, not answer data, so none of the immutability, determinism
or auditability guarantees touch it. Config supplies the DEFAULT for each of the
three respondent axes, including which fonts a deployment offers at all
(curation); the respondent's own choice, when they make one, wins.

## The four token groups

Everything the portal renders resolves from a CSS custom property declared in
`packages/ui/src/theme.css`. There are exactly four groups, and nothing outside
them is a styling decision the portal is allowed to make.

| Group         | Tokens                                                                                                | Varies with                   |
| ------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1. Colour     | `--color-*` (36 tokens)                                                                               | theme x mode                  |
| 2. Typography | `--font-fallback-*`, `--font-portal`, `--font-mono`, `--type-*`                                       | font selection (the registry) |
| 3. Spacing    | `--space-control-h` `--space-control-pad-x` `--space-field-gap` `--space-section-pad` `--space-stack` | density (three levels)        |
| 4. Radius     | `--radius-control` `--radius-card` `--radius-sm`                                                      | corner preset                 |

### Selector convention

Every rule in `theme.css` and `fonts.css` is anchored on the **scope carrier**:

```css
:is(:root, [data-qcms-theme-scope]);
```

The token set therefore applies to the document root **or** to any element carrying
`data-qcms-theme-scope`, which is what lets a themed subtree exist inside a document
themed differently (ADR-38). The portal stamps the attribute on its `<html>`, so
there the two cases are the same element. Nothing about the document-root form
changed: an adopter's plain `:root` overrides work exactly as they did.

**The one subtree consumer today is the QCMS app's form preview** (task 058). It puts
the attribute, a `data-theme` and a mode class on the preview container, so an author
sees a question in a respondent theme while the authoring app around it keeps its own
Cobalt and the operator's own mode. Two facts a future subtree consumer needs, both
learned there:

- The token variables scope, but the **behaviour some of them describe does not**. The
  WCAG 1.4.12 text-spacing floors are applied by the portal _app's_ `body` rule
  (`apps/portal/app/globals.css`), not by the token sheet, so a host that is not the
  portal must restate them on its carrier - otherwise the subtree renders at the host's
  own spacing while every token assertion still passes.
- **A portalled overlay leaves the carrier.** A react-aria `Popover` (the `Select`
  listbox, `DatePicker`'s calendar, `Menu`) is attached to `document.body`, so it is not
  a descendant of any carrier and inherits the document root's tokens instead. There is
  no selector that fixes this; the routes that would are `react-aria`'s
  `UNSAFE_PortalProvider` or RAC's `PopoverContext` / `UNSTABLE_portalContainer`, and
  neither is adopted here.

The knobs then ride the anchor, on the anchor element rather than on the document
root specifically:

| Axis    | Carrier                               | Values                                                                 |
| ------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Anchor  | `:is(:root, [data-qcms-theme-scope])` | the document root, or any scoped container                             |
| Mode    | anchor class                          | `.light` (the base), `.dark`, `.hc`                                    |
| Theme   | anchor attribute                      | (absent) or `[data-theme="slate"]` = default, `harbor`, `sand`, `plum` |
| Corners | anchor class                          | (none) = Subtle, `.radius-sharp`, `.radius-rounded`, `.radius-pill`    |
| Font    | anchor class                          | `.font-system` (the shipped default) or `.font-<registry key>`         |
| Density | anchor class                          | (none) = Comfortable, `.density-compact`, `.density-spacious`          |

Two of these are a positive class and two are an absence, and the difference is not
arbitrary. **Font** is always emitted (the `.font-system` block restates the System
stack) so the control can switch back to System by swapping one class rather than
by removing one. **Corners** and **density** default to an absence, because their
default values ARE the base anchor block and a `.density-comfortable` class
restating them would be a second place to edit the same numbers. **Mode** emits
`.light` even though Light is the base, so the pre-paint script can swap it like
the other two.

The default theme lives in the bare anchor blocks, so setting `data-theme` is
enough to switch and removing it restores the default. The `.hc` blocks are
emitted **after** every light/dark block: that source order is load-bearing,
because the anchor plus `.hc` and the anchor plus `[data-theme="x"]` are both
specificity (0,1,0) + (0,1,0) = (0,2,0).

**`:is()`, never `:where()`.** They differ by exactly the property that makes the
carrier safe. `:root` is (0,1,0), `[data-qcms-theme-scope]` is (0,1,0), and `:is()`
takes its most specific argument, so the anchor weighs exactly what the bare `:root`
it replaced weighed and no rule in the sheet can flip. `:where()` is specificity 0
and would silently re-rank every block against the adopter override surface and the
source-order guarantee above. `packages/ui/src/theme-tokens.test.ts` computes real
CSS specificity (an (id, class, type) triple, with `:is()`/`:not()`/`:has()` taking
their most specific argument and `:where()` taking zero) and asserts both facts,
including that each anchored selector scores exactly what its pre-rewrite `:root`
form scored.

**The treatment sheet is different on purpose.** `theme-components.css` anchors on
the **bare** `[data-qcms-theme-scope]` and drops `:root` entirely: its rules describe
treatment over `[data-rac]` elements, which every host built on the same component
kit renders too, so an `:is(:root, …)` prefix would contain nothing (every such
element already descends from the document root). Making the attribute the sole
carrier makes containment real, which is what lets the QCMS app import that sheet
for its form preview without restyling its own control layer. Its `@theme` block is
the one part that cannot be scoped: Tailwind theme variables are global to a build
by construction, so a host that imports the sheet either takes the raised
`text-sm` / `text-xs` steps app-wide or re-pins them in its own later `@theme` block
(`apps/admin/app/globals.css` does the latter, deliberately).

### Group 2: the WCAG 1.4.12 floors are numeric requirements

| Floor                    | Token                         | Value      |
| ------------------------ | ----------------------------- | ---------- |
| Body text >= 16px        | `--type-body`, `--type-label` | `1rem`     |
| Hint text >= 14px        | `--type-hint`                 | `0.875rem` |
| Line-height >= 1.5       | `--type-line-height`          | `1.5`      |
| Letter-spacing >= 0.12em | `--type-letter-spacing`       | `0.12em`   |
| Word-spacing >= 0.16em   | `--type-word-spacing`         | `0.16em`   |
| Paragraph spacing >= 2em | `--type-paragraph-spacing`    | `2em`      |

Plus `--type-step-title` (`clamp(1.55rem, 3.5vw, 1.85rem)`) and
`--type-title-line-height` for the step title, and `--type-numeric` (`"tnum"`) for
tabular figures. No mode, theme, font or density level may lower a floor;
`packages/ui/src/theme-tokens.test.ts` asserts each one and asserts that every
theme x mode resolution leaves it unchanged, and `apps/portal/e2e/fonts.pw.ts`
re-measures every floor on rendered text under every font the registry ships.

### Group 2: the fallback tail is one token

The rest of group 2 is what a respondent reads when the primary face is **not**
there: missing from the device, refused by the browser, or still downloading. Three
tokens carry it, and they are the only place in the product where a font-family list
is written down.

| Token                   | Value                                                                                                                                                                | Consumed by                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `--font-fallback-sans`  | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif,` then the four emoji/symbol faces | `--font-portal`, `--font-admin`, 19 registry entries      |
| `--font-fallback-serif` | `ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`                                                                                                        | the registry's Traditional & Corporate entries            |
| `--font-fallback-mono`  | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Code", "Roboto Mono", Consolas, "Liberation Mono", monospace`                                             | `--font-mono`, the registry's Monospace entries           |
| `--font-portal`         | `var(--font-fallback-sans)`, or a family plus that token                                                                                                             | the portal `body`, the app's respondent preview island    |
| `--font-mono`           | `var(--font-fallback-mono)`                                                                                                                                          | the submission reference, the app's ids, hashes and rules |

Read the sans tail left to right: `ui-sans-serif` is the CSS Fonts 4 generic for the
system's sans UI face and is honoured by Chromium and WebKit; `system-ui` is the
same intent for Firefox, which has no `ui-sans-serif`. `system-ui` is deliberately
**not** first and never alone, because it resolves from the OS/UI locale rather than
the content language: on a CJK-locale machine it is a CJK UI face whose Latin glyphs
are oversized, and as a generic it used to short-circuit the rest of the list for
non-Latin text (Mozilla bug 1724907, `csswg-drafts` issue 3658). Then the named
platform faces, then `sans-serif` - CSS Fonts 4 section 2.1 encourages a generic last
for robustness, and it is the only entry a reader's own per-script font preference
can answer. The four emoji and symbol faces sit **after** the generic on purpose, as
Bootstrap 5's Reboot does: they are consulted per glyph, for codepoints nothing
earlier carries, so without them a respondent whose UI font has no emoji reads a
`.notdef` box in authored content.

**How a theme, an entry or a deployment overrides it.** End the value in the tail
token instead of restating a list:

```css
:root[data-theme="slate"] {
  --font-portal: "Your Face", var(--font-fallback-sans);
}
```

That is exactly what every registry entry emits, and what `--font-admin` in
`apps/admin/app/theme.css` does. Overriding a **tail** is the deployment-level move
and belongs in `apps/portal/app/adopter-theme.css`, the single documented override
surface: a deployment whose audience reads one script can prepend a face for it
there and every family token picks it up at once.

`scripts/check-font-tokens.mjs` is what keeps the property true. It fails on a
`font-family` that names anything but a token (an inline `var(--font-portal, ...)`
fallback included - the token is always declared, so those arguments can never fire
and only exist to drift), on a `--font-*` value outside `theme.css` that does not end
in a tail, and on a Tailwind `font-sans` / `font-serif` / `font-[...]` utility, which
would reach Tailwind's own stack. `font-mono` is fine, because `--font-mono` is a
token and that utility reads it. `apps/portal/e2e/fonts.pw.ts` then measures the
resolved result in a real browser: body text is the configured family followed by
exactly `--font-fallback-sans`, and the submission reference is exactly
`--font-mono`.

**What this is not.** A fallback tail is not multi-script coverage. The shipped
`woff2` files are Latin subsets, so non-Latin text still depends on what the reader's
device already has. Deciding which scripts QCMS self-hosts faces for is the open half
of issue #27.

### Group 3: the three density levels

Density is the respondent's control over the spacing group, and it is the only axis
that moves these five values. Comfortable is the base anchor block, so it carries
no class.

| Token                   | Compact           | Comfortable (default) | Spacious       | Applies to                                              |
| ----------------------- | ----------------- | --------------------- | -------------- | ------------------------------------------------------- |
| `--space-control-h`     | 36px              | 44px                  | 52px           | input / textarea / date box / select trigger min-height |
| `--space-control-pad-x` | 0.7rem            | 0.9rem                | 1.1rem         | control and option-row inline padding                   |
| `--space-field-gap`     | 1.25em            | 2em                   | 2.75em         | question-to-question rhythm                             |
| `--space-section-pad`   | 0.875rem / 1.5rem | 1.25rem / 2.25rem     | 1.75rem / 3rem | step-card padding, narrow / `sm` and wider              |
| `--space-stack`         | 0.375rem          | 0.5rem                | 0.75rem        | label-to-control gap, option-row block padding          |

Four rules bound what a density level may do, and each is asserted by
`packages/ui/src/theme-tokens.test.ts` over the shipped CSS:

1. **Only the five `--space-*` tokens.** A level that could set a `--type-*` value
   could lower a WCAG 1.4.12 floor, and one that could set a `--color-*` value
   could break a contrast pair. Those floors and ratios are asserted against the
   base blocks, so that guarantee is only as good as this boundary.
2. **`--space-control-h` never below 24px**, at any level and at either viewport:
   that token is the WCAG 2.5.8 target-size floor. Compact's 36px clears it by
   12px, and the rendered targets are re-measured per density in
   `apps/portal/e2e/appearance.pw.ts`.
3. **Monotonic**: Compact < Comfortable < Spacious on every token, so the control
   is a scale a respondent can reason about rather than three unrelated looks.
4. **The one media query sets spacing tokens only**, so no viewport can reach a
   floor either. Every floor and contrast assertion in the token suite resolves
   the sheet at the narrow end; this boundary is what makes checking it once
   enough. A second media condition fails the suite deliberately, because it would
   need its own decision about which end the floors are read at.

**The viewport dimension on `--space-section-pad`** (issue #188, Code Owner
decision 2026-09-02). The step card carries a single `p-(--space-section-pad)` and
no Tailwind variant, so the card's phone padding is a token decision. The token is
therefore declared twice in `theme.css`: mobile-first in the three density blocks,
then raised by one `@media (min-width: 40rem)` block - Tailwind's `sm`, the same
width the card's pre-051 `p-5` / `sm:p-8` turned over at. Comfortable's narrow
value **is** that `p-5`, so the phone layout the token contract ships is the phone
layout that was reviewed before 051.

On a 412px phone the card now spends 28px (Compact), 40px (Comfortable) or 56px
(Spacious) of width on padding, against 48 / 72 / 96px while the token was flat.
The three levels keep the same 0.7x and 1.33x either side of Comfortable that the
wide values use, which is what keeps the density control a visible choice at the
narrow end as well as the wide one; the suite asserts the ordering at both.

The other four tokens have no viewport dimension. Control height and the
target-size floor are about fingers rather than screens, and the gaps are already
relative units, so adding a width story to them would ship a second layout nobody
asked for. Rejected alternatives are on the issue: a fluid `clamp()` (hands every
width a bespoke padding and needs three anchor pairs to keep the levels apart), a
Tailwind `sm:` variant back on the component (returns the decision to markup), and
leaving it flat.

### Group 4: the corner presets

| Token              | Sharp | Subtle (default) | Rounded | Pill  | Applies to                                            |
| ------------------ | ----- | ---------------- | ------- | ----- | ----------------------------------------------------- |
| `--radius-control` | 0     | 6px              | 10px    | 999px | inputs, textarea, date field, select trigger, buttons |
| `--radius-card`    | 0     | 10px             | 16px    | 20px  | step card, panels, banners, select popover            |
| `--radius-sm`      | 0     | 4px              | 6px     | 8px   | checkbox indicator, date segments, options            |

Geometry only, so no contrast ratio depends on this group.

## How the vendored components consume spacing, radius and figures

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
react-aria-components element), all of them **inside** the scope carrier
`[data-qcms-theme-scope]` (see the selector convention above).

The same mechanism carries **tabular figures**. Numeric controls (the number
field's inner input, the date field's spinbutton segments, any input the renderer
marks numeric) get `font-feature-settings: var(--type-numeric)` there, so digits
share one advance width and a corrected digit does not shift the layout. It is
unconditional across the font registry on purpose: most families ship the feature
and honour it, the rest ignore it harmlessly, and no font selection can turn it
off. It is a token rather than a literal so an adopter can change it in one place.

Consuming the three files, in this order:

```css
@import "tailwindcss";
@import "@roonga/qcms-ui/theme.css"; /* the token values */
@import "@roonga/qcms-ui/theme-components.css"; /* the components consume them */
@import "@roonga/qcms-ui/fonts.css"; /* the font registry */
```

`theme.css` and `fonts.css` are each valid plain CSS and can be imported by a
non-Tailwind host; `theme-components.css` needs Tailwind v4 in the build (the
components need it anyway). `fonts.css` must come after `theme.css`, because its
`.font-<key>` blocks override the System stack that `theme.css` declares.

## The font registry (task 052)

Group 2's family token, `--font-portal`, is populated by a **declarative,
self-hosted font registry**. The manifest is
`packages/ui/src/font-registry.ts`; everything else is derived from it.

### Self-hosted means the binaries are in the repository

The `woff2` files are **committed** under `packages/ui/src/fonts/`, and
`packages/ui/src/fonts.css` references them with relative `url()`s that the app
build fingerprints and serves from the deployment's own origin.

That choice is deliberate, and the alternative was a build-time or setup-time fetch
from Google Fonts. QCMS has spent real work removing network dependencies from CI
(the GHCR Postgres mirror, issue #74; the Ryuk Docker Hub dependency, issue #150),
and a fetch step would reintroduce exactly that class of fragility: a third-party
host outage, a rate limit or a silent URL change becomes a red build or, worse, a
deployment whose fonts quietly stop rendering. Committed bytes cost repository size
once and can never fail. The size is small because every file is the **Latin**
subset:

|                       |                                                              |
| --------------------- | ------------------------------------------------------------ |
| Families              | 22 self-hosted + System (which downloads nothing)            |
| Faces                 | 25 (the Accessibility group ships 400 and 700)               |
| Files                 | 24 (Lexend is a variable font: its two faces share one file) |
| Total committed       | 710,984 bytes (~694 KiB)                                     |
| Largest single family | OpenDyslexic, 235,636 bytes across two weights               |

A respondent downloads **one** family, so the per-visit cost is 8-60 KB, not the
whole set. The full payload is only what the repository and the published package
carry.

### The groups

| Group                   | Keys                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ |
| System                  | `system` (always present, never removable)                                     |
| Accessibility           | `atkinson` `lexend` `opendyslexic`                                             |
| Popular                 | `inter` `roboto` `opensans` `lato` `poppins` `montserrat`                      |
| Playful & Kids          | `andika` `fredoka` `baloo2` `comicneue` `patrickhand`                          |
| Traditional & Corporate | `merriweather` `lora` `ptserif` `librebaskerville` `ibmplexserif` `publicsans` |
| Monospace               | `jetbrainsmono` `geistmono`                                                    |

Families, keys, weights, groups and licenses come from the font design deliverable
(`plan/theme-palettes/fonts_config.py`). Two things are authored here because the
deliverable does not carry them: the **Monospace** group, and the **fallback
stack** on every entry.

Weights follow the deliverable's rule: the Accessibility faces ship 400 **and** 700
because weight itself carries legibility for low-vision and dyslexic readers; every
other family ships 400 only, and the browser synthesises bold.

### What an entry may and may not do

A registry entry renders to exactly one selector block that sets exactly one token:

```css
:is(:root, [data-qcms-theme-scope]).font-atkinson {
  --font-portal: "Atkinson Hyperlegible", var(--font-fallback-sans);
}
```

It may **never** set a `--type-*` value. Those carry the WCAG 1.4.12 floors, and no
font selection is allowed to lower one. `font-registry.test.ts` asserts the
one-declaration shape, and `fonts.pw.ts` re-measures every floor on rendered text
under every entry (see the measured numbers below).

An entry names its family and then **delegates its tail to one of the three
`--font-fallback-*` tokens** rather than restating a list (issue #27). That is what
makes the tail improvable: it is declared once, in `theme.css`, so a change to it
reaches all 23 entries and both apps at the same time. It also fixes the import
order the contract already required - a `.font-<key>` block has to come after
`theme.css` to override the base `--font-portal` at all, and now an adopter who
imports `fonts.css` alone gets a `font-family` that is invalid at computed-value
time rather than a silently wrong face.

Each tail ends in a CSS generic family, so a browser that refuses the webfont still
gets the right _kind_ of face. The shipped subsets are Latin, so text outside Latin
falls back glyph-by-glyph through the tail: it now names the broad-coverage and
emoji faces a device is likely to have, but it is still not self-hosted multi-script
coverage. Deciding which scripts QCMS ships faces for is the open half of
**issue #27**.

### Licensing

Every family is open-licensed and MIT-redistributable. Each entry carries its
upstream copyright notice verbatim, `packages/ui/src/fonts/NOTICE.md` is the
generated roll-up, and the license texts ship beside the binaries
(`LICENSE-OFL-1.1.txt`, `LICENSE-Apache-2.0.txt`) - which is what OFL-1.1
section 2 and Apache-2.0 section 4(a) each require of a redistribution.

Every family resolves to **OFL-1.1** today. Roboto is recorded as
`OFL-1.1 OR Apache-2.0`: the design deliverable lists Apache-2.0, and upstream has
since relicensed Roboto under OFL-1.1 (`google/fonts` now ships
`ofl/roboto/OFL.txt`). Both grants are permissive, both license texts ship, so the
redistribution is covered whichever applies to the shipped bytes.

### Per-deployment font config

| Variable            | Values (default first)                      | Effect                            |
| ------------------- | ------------------------------------------- | --------------------------------- |
| `QCMS_PORTAL_FONT`  | `system`, or any registry key               | the `font-<key>` root class       |
| `QCMS_PORTAL_FONTS` | registry keys, comma and/or space separated | the subset offered to respondents |

`QCMS_PORTAL_FONTS` is the **curation** surface for launch (the admin UI over the
same setting is Phase-4). Unset or empty offers the whole registry, never an empty
list; unknown keys are dropped rather than fatal; and `system` is always offered
and cannot be removed, because it is the only entry guaranteed to render without a
download. A `QCMS_PORTAL_FONT` that is unknown **or curated out** falls back to
`system`: a default a respondent could never switch back to is not a legal default.

The respondent font control renders exactly `portalFontChoices()`, so curation is
what a respondent is offered, and the fallback above is the operator-side half of
the same rule.

### Adding or removing a font

Add is **one manifest entry plus its binary**; remove is **one manifest entry**.

1. Drop the Latin `woff2` into `packages/ui/src/fonts/` as `<key>-<weight>.woff2`
   (or a single file named in the entry, for a variable font).
2. Add one `webfont({ ... })` entry to `FONT_REGISTRY` in
   `packages/ui/src/font-registry.ts`, with the upstream copyright notice verbatim.
3. Run `pnpm --filter @roonga/qcms-ui fonts:generate` to regenerate `src/fonts.css` and
   `src/fonts/NOTICE.md`. Never hand-edit either.
4. `pnpm --filter @roonga/qcms-ui test` (the manifest invariants and the drift guard) and
   `pnpm verify:browser` (the render, request-count and floor sweep).

A license that is not OFL-1.1 or Apache-2.0 needs the CONTRIBUTING license check
and its text added beside the binaries; the test fails until it is there.

### Measured: the floors hold under every shipped font

`fonts.pw.ts` sweeps all 23 entries on a real page at default density and reads
computed style each time. Body 16px, line-height 24px (1.5), letter-spacing 1.92px
(0.12em), word-spacing 2.56px (0.16em), vendored label slot 16px, vendored hint
slot 14px - **identical for every entry**, System included, because the floors are
carried by tokens a font entry cannot touch. The same run records 24 of 24 registry
font files fetched and **0** off-origin requests for the whole sweep. The table is
attached to the Playwright report and written to
`apps/portal/.playwright/font-floors.txt`.

## The four predefined themes

Colour values come from the theme-palette design deliverable
(`plan/theme-palettes/`: `THEMES.md` documents every pair, `tokens.css` holds the
authored values) and are copied into `theme.css` verbatim, never re-derived.

| Key      | Name       | Character                                                      |
| -------- | ---------- | -------------------------------------------------------------- |
| `slate`  | Slate Teal | the shipped default: muted blue-green over cool slate neutrals |
| `harbor` | Harbor     | calm corporate blue; info shares the primary hue               |
| `sand`   | Sand       | warm neutral with a muted terracotta primary                   |
| `plum`   | Plum       | deep violet; info stays blue to remain distinct                |

Each is authored in **Light and Dark**. Semantic colours stay in their
conventional lanes (danger red, success green, warning amber) so meaning is never
carried by hue alone.

### Measured contrast

`theme-tokens.test.ts` recomputes every critical pair from `theme.css` with the
WCAG 2.2 sRGB relative-luminance formula, so these numbers cannot drift from the
shipped values. Targets: 4.5:1 body text and 3:1 UI in Light and Dark, **7:1 body
text** in High-contrast. The worst pair in each combination:

| Theme / mode   | Worst text pair               | Target | Worst UI pair                       | Target |
| -------------- | ----------------------------- | ------ | ----------------------------------- | ------ |
| slate / light  | 5.91:1 (danger-fg / danger)   | 4.5    | 3.26:1 (border-strong / background) | 3      |
| slate / dark   | 6.78:1 (text-muted / surface) | 4.5    | 3.33:1 (border-strong / surface)    | 3      |
| slate / hc     | 9.75:1 (danger-fg / danger)   | 7      | 9.26:1 (focus-ring / background)    | 3      |
| harbor / light | 5.91:1 (danger-fg / danger)   | 4.5    | 3.74:1 (border-strong / background) | 3      |
| harbor / dark  | 6.72:1 (text-muted / surface) | 4.5    | 3.25:1 (border-strong / surface)    | 3      |
| harbor / hc    | 9.75:1 (danger-fg / danger)   | 7      | 9.26:1 (focus-ring / background)    | 3      |
| sand / light   | 5.73:1 (primary-fg / primary) | 4.5    | 3.55:1 (border-strong / background) | 3      |
| sand / dark    | 7.02:1 (primary-fg / primary) | 4.5    | 3.26:1 (border-strong / surface)    | 3      |
| sand / hc      | 8.80:1 (primary-fg / primary) | 7      | 8.80:1 (primary / surface)          | 3      |
| plum / light   | 5.91:1 (danger-fg / danger)   | 4.5    | 3.88:1 (border-strong / background) | 3      |
| plum / dark    | 6.34:1 (text-muted / surface) | 4.5    | 3.33:1 (border-strong / surface)    | 3      |
| plum / hc      | 9.75:1 (danger-fg / danger)   | 7      | 9.26:1 (focus-ring / background)    | 3      |

## High-contrast is ONE mode layer, not a palette per theme

This is the part that is easiest to get wrong. High-contrast is **not** a third
palette authored per theme. It is a single, theme-agnostic layer:

- **Token values** (the `.hc` block in `theme.css`): pure `#000` text and borders on
  `#fff` surfaces, one muted text, the fixed AAA semantic colours, one universal
  focus ring `#0a3ea8`.
- **CSS treatment** (`[data-qcms-theme-scope].hc` in `theme-components.css`): 2px borders at
  `--color-border-strong` on every control edge, flat surfaces (every Tailwind
  shadow utility neutralized), a 3px focus outline, separators at full contrast,
  and `color-scheme: light` (High-contrast is a distinct choice, not Dark).
- **A theme contributes only its accent**: `--color-primary` plus hover / active /
  foreground, via a four-token `[data-theme="x"].hc` block on the anchor. Links and primary
  UI pick it up, so each theme keeps a whisper of brand.

| Theme  | HC accent                           | primary-fg / primary |
| ------ | ----------------------------------- | -------------------- |
| slate  | `#0b453d` (in the base `.hc` block) | 10.86:1              |
| harbor | `#0a3a8a`                           | 10.57:1              |
| sand   | `#7a3717`                           | 8.80:1               |
| plum   | `#54148f`                           | 11.20:1              |

**A new theme gets High-contrast for free** by adding one AAA-safe accent block.
`theme-tokens.test.ts` enforces the shape: every theme must resolve to the
identical HC palette apart from those four accent tokens, and an alternate theme's
`.hc` block may not declare anything else.

## The automatic contrast baseline: `prefers-contrast` and `forced-colors`

High-contrast above is a **choice**: a respondent picks it, or a deployment
defaults to it, and either way QCMS decides what the page looks like. This
section is the other kind. `prefers-contrast: more` and `forced-colors: active`
are settings the person made in their operating system, before the browser
opened, and the portal honours them whatever theme it is running (issue #28).
Neither is gated behind managed theming and neither needs any configuration.

The three doors do not overlap, and it is worth being exact about which is which:

| Signal                   | Who set it             | What changes                                            |
| ------------------------ | ---------------------- | ------------------------------------------------------- |
| `.hc` mode               | respondent or operator | the whole QCMS palette, to the shared HC layer          |
| `prefers-contrast: more` | the OS                 | edges and focus rings only, inside the current palette  |
| `forced-colors: active`  | the OS                 | the palette is the USER's; QCMS keeps shapes and states |

`prefers-contrast: more` also **defaults the mode to High contrast** when
`QCMS_PORTAL_MODE` is `auto` (see the precedence list below): that is the
pre-paint script's job and it happens before any of this. The CSS half here is
what runs when the mode is not `auto`, or when the respondent has chosen a
different mode and still wants firmer edges.

### What `prefers-contrast: more` may do

Two moves, and the boundary is the point:

1. Control edges take `--color-border-strong` instead of `--color-border`. Those
   two are the higher- and lower-contrast half of one authored pair, and the
   token suite already asserts the strong half at >= 3:1 against every
   background in every theme x mode. So the step-up lands on a ratio that is
   proven rather than on a new colour. That includes the checkbox and radio
   indicator, whose edge is the one that lives on a different element from its
   state: react-aria keeps `data-selected` on the `label[data-rac]` root, so the
   rule rides the label and the border rides its indicator child.
2. The focus ring goes from 2px to the 3px the `.hc` layer uses.

It may **not** touch a `--color-*` value or a `--type-*` token. Contrast pairs
and the WCAG 1.4.12 floors are asserted against the base blocks, so a rule here
that could move either would put the whole assertion out of reach.

It also leaves alone every edge whose colour **is** a state rather than chrome,
because flattening one of those to the neutral strong border would buy a contrast
step by spending a signal:

| Left alone                                   | Its edge          | What the colour says           |
| -------------------------------------------- | ----------------- | ------------------------------ |
| An invalid control                           | `--color-danger`  | this answer was refused        |
| A selected or indeterminate option indicator | `--color-primary` | this option is chosen          |
| The Appearance panel's Apply button          | `--color-primary` | this is the panel's one action |

(`.hc` does flatten the invalid edge, on purpose: there the palette really is two
colours and the error text carries the meaning instead.)

### What a theme may and may not override under forced colours

Under `forced-colors: active` the palette **is not the theme's any more**. The
user agent replaces it with the user's own: `color`, `background-color`,
`border-color`, `outline-color`, `fill` and `stroke` are forced to system
colours, and `box-shadow`, `text-shadow` and non-`url()` `background-image` are
forced to `none`. An author declaration is honoured only where its value is a
**system-colour keyword**; every other value is discarded silently, with no
error and no visible failure until someone looks at the page in that mode.

So the rule for a theme, and for an adopter's `adopter-theme.css`, is short:

- **A theme may not set a colour under forced colours.** Not its brand accent,
  not a semantic colour, not a neutral. Every `--color-*` value it declares is
  discarded there. This is not a restriction QCMS imposes; it is what the mode
  is.
- **A theme keeps everything that is not a colour.** Geometry, spacing, radius,
  type scale and the font selection are untouched, so the page is still
  recognisably the deployment's page.
- **QCMS's job is to keep the shapes and the states legible inside the user's
  palette**, which is what the two blocks at the end of
  `packages/ui/src/theme-components.css` (the component kit) and
  `apps/portal/app/globals.css` (the portal's own chrome) do. They are a short
  list of specific losses, never a second design:

| What is lost                                                         | Restated as                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A focus ring drawn as a Tailwind `ring-*` (that is a `box-shadow`)   | a real `outline` in `Highlight`                                                                                           |
| A control's border given up on focus (`focus:border-transparent`)    | the edge restated in `CanvasText`                                                                                         |
| The radio's dot: a filled circle, no border, no glyph                | `CanvasText`                                                                                                              |
| The date segment being edited: a background fill                     | `Highlight` / `HighlightText`                                                                                             |
| The focused row of a listbox or menu: a background fill              | `Highlight` / `HighlightText`                                                                                             |
| The number field's dividers and a menu separator: filled `1px` boxes | `CanvasText`                                                                                                              |
| A disabled control faded with `opacity`                              | `GrayText`, read off `label[data-rac][data-disabled]` for an option row (its indicator child carries no state of its own) |
| The portal's primary button: a fill with no border                   | a `1px solid ButtonBorder` edge                                                                                           |
| The skip link held off the page by a shadow                          | a `1px solid CanvasText` edge                                                                                             |
| The selected Appearance chip's fill                                  | `Highlight` / `HighlightText`                                                                                             |
| In-content links coloured by the theme                               | `LinkText`                                                                                                                |

A checked checkbox needs no rule at all, and the reason is worth keeping: its
tick is an SVG drawn in `currentColor`, which forces to `CanvasText` inside a
`Canvas` box. The radio has no glyph, which is exactly why it needs one.

### No rule uses `forced-color-adjust: none`, deliberately

`forced-color-adjust: none` opts an element out of the user's palette. Every
colour in the portal that carries meaning - selected, checked, focused, invalid,
disabled - has a system-colour pair that says the same thing **inside** that
palette, so there is nothing here the property would buy that a pair does not.
Using it anyway would take a choice away from the one group of people the mode
exists for, and MDN's own rule for the property is that it may support a
contrast requirement, never override one.

The case that would justify it is a swatch whose exact colour **is** the content:
a colour picker, a chart legend keyed by hue, a brand-colour preview. The portal
renders none of those. If one ever arrives it gets the property on that element
alone, with a text or shape label beside it so the meaning does not depend on the
swatch either way. `theme-contrast.test.ts` fails on the property appearing
anywhere in the component sheet, so the decision cannot be reversed by accident.

### Measured

`apps/portal/e2e/forced-colors.pw.ts` emulates both features in Chromium and
walks the kitchen-sink form. It asserts a drawn boundary (a border or an outline
with non-zero width, a drawing style and a non-transparent colour) on every
control type the renderer produces plus the portal's own chrome; that a focused
text control keeps its edge AND gains a painted ring, with the `box-shadow` the
ring used to be confirmed gone; that the radio dot, the checkbox tick and the
selected Appearance chip each resolve to the system colour they should; and that
axe is clean in all three states. Every comparison is against system colours
resolved from the live page, because the forced palette is the user's and its
values are not knowable up front - and each test first asserts that the page
body's background really is `Canvas`, so a run where the emulation queried the
media feature without forcing the palette fails instead of passing vacuously.

`packages/ui/src/theme-contrast.test.ts` guards the parts that are about what
the blocks may NOT contain: system colours only under forced colours, no
`forced-color-adjust`, edges and rings only under `prefers-contrast: more`, and
the invalid-control exclusion.

## Per-deployment selection (config only in this slice)

QCMS is single-tenant (ADR-20), so one deployment runs one theme. The portal reads
it from the environment in `apps/portal/lib/server/theme.ts` and `app/layout.tsx`
stamps it onto `<html>` during SSR.

| Variable                 | Values (default first)               | Effect                             |
| ------------------------ | ------------------------------------ | ---------------------------------- |
| `QCMS_PORTAL_THEME`      | `slate` `harbor` `sand` `plum`       | `data-theme` attribute             |
| `QCMS_PORTAL_CORNERS`    | `subtle` `sharp` `rounded` `pill`    | corners root class                 |
| `QCMS_PORTAL_MODE`       | `auto` `light` `dark` `hc`           | default mode class                 |
| `QCMS_PORTAL_DENSITY`    | `comfortable` `compact` `spacious`   | default density class              |
| `QCMS_PORTAL_FONT`       | `system` or a registry key           | default `font-<key>` root class    |
| `QCMS_PORTAL_FONTS`      | registry keys, comma/space separated | the offered subset                 |
| `QCMS_PORTAL_BRAND_NAME` | any text                             | header mark and document `<title>` |
| `QCMS_PORTAL_BRAND_LOGO` | a `/path` or a `data:image/...` URI  | optional logo beside the text      |

An unrecognized value falls back to the default rather than throwing: a typo in
presentation config must not take a deployment down, and the fallback is always
the safe brand-neutral default. `QCMS_PORTAL_MODE=hc` is how a deployment ships
High-contrast as its default.

Mode, font and density are **defaults, not settings**: they are what a first-time
visitor gets, and the respondent's own choice overrides them from then on (below).
Theme and corners have no respondent control, so for those two the config value is
the whole story.

### The brand mark

`QCMS_PORTAL_BRAND_NAME` is the text in the header and the document title. The
name is **always rendered as text**, and a configured logo sits beside it rather
than replacing it: a logo-only mark makes the header's accessible name depend on
alt text supplied in an environment variable, and a blank or careless one leaves a
respondent with an unlabelled image where the organisation's name should be. So
the logo is decorative (`alt=""`) and the text carries the meaning, which is why
there is no `..._LOGO_ALT` variable to get wrong.

`QCMS_PORTAL_BRAND_LOGO` accepts only a **root-relative path** the deployment
serves itself, or an inline **`data:` image**. That is not caution for its own
sake: the shipped CSP sends `img-src 'self' data:` (SEC-9), so a browser refuses an
off-origin logo outright, and accepting one would render a broken image on every
page and put pressure on the policy to be widened. A protocol-relative `//host/x`
is rejected explicitly, because it starts with `/` but points off-origin.

Before this, the header was `<span>QCMS</span>` and the title was the same literal
(issue #25): an adopter could only rebrand by editing source, and a respondent
opening a registration link was shown the engine's name rather than the name of
whoever sent them the link.

## Respondent runtime controls (mode, font, density)

The header carries an **Appearance** disclosure with three controls. It is
collapsed by default because at a phone width three chip groups plus a font select
would be most of the viewport above the first question, and a respondent who needs
High-contrast or a legibility face opens it once: the choice persists.

| Control | Shape                                                                    | Writes                                       |
| ------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| Mode    | radio group, chips: Light / Dark / High contrast                         | `qcms-theme` cookie + mode root class        |
| Font    | native `<select>` with an `<optgroup>` per registry group                | `qcms-font` cookie + `font-<key>` root class |
| Density | radio group, chips with a density icon: Compact / Comfortable / Spacious | `qcms-density` cookie + density root class   |

Each control swaps the root class immediately (that is what the respondent sees)
and writes the cookie (that is what makes the next server render already correct).
There is no round trip and no re-render of the form.

### Why cookies, and why that is the whole no-flash story

The choice has to be readable **on the server**, because the root class must be
right in the first byte of HTML or the respondent sees a flash. `localStorage` is
unreachable during SSR, so a localStorage-backed control can only correct the page
after it loads - which IS the flash. With cookies, `app/layout.tsx` reads all three
and stamps the classes during SSR, so **font and density need no pre-paint script
at all**.

Mode keeps one, for one reason: it has a fourth input the server cannot see. Only
the browser knows `prefers-color-scheme` and `prefers-contrast`, so the nonced
(SEC-9) inline script in `<head>` is the only thing that can apply them, and it
runs synchronously during parsing, before anything is painted.

Mode precedence, highest first:

1. `?mode=light|dark|hc` in the URL (the manual door, and how the modes are
   reachable without any UI).
2. The `qcms-theme` cookie: the respondent's own choice.
3. The OS signals, but **only when `QCMS_PORTAL_MODE` is `auto`** - that config
   value is precisely the opt-in to OS defaulting, so a deployment that pins a mode
   is not second-guessed. Among the signals, **`prefers-contrast: more` outranks
   `prefers-color-scheme: dark`**: a contrast preference is an accessibility need
   someone went into their system settings to state, and honouring the weaker
   signal first would hand them a dark theme instead of the contrast they asked
   for.
4. The configured mode.

**Every door is a fallback for the one above it.** A layer only wins when it yields
a _known_ mode, so an unrecognised value at any door falls through to the next
input rather than resolving to Light: `?mode=potato` lands on the respondent's
`qcms-theme` cookie, and a hand-edited `qcms-theme=darkish` lands on the OS signals
or the configured mode. Treating "present" as "decided" would make a malformed link
stronger than a valid choice, which is how a High-contrast setting once got
silently discarded (issue #197).

These cookies are presentation chrome, never a credential: no `httpOnly` (the
browser has to write them), `SameSite=Lax`, `Path=/`, one year, and `Secure` in
production. Nothing about a session, an identity or an answer is inferable from a
mode keyword.

**The no-flash claim is measured, not asserted.** `appearance.pw.ts` installs an
init script that samples `<html class>` and the painted body background on each of
the first animation frames. A `requestAnimationFrame` callback runs immediately
before the browser paints that frame, so the first sample containing a `<body>` is
the earliest frame in which the page background could have appeared at all; the
test asserts that colour already equals the settled colour. It covers all three
cookie modes and both OS-derived defaults.

### Selected state is never colour-only

An exit criterion, not a nicety, and this is the one control a colour-blind or
low-vision respondent has to operate in order to fix their own experience. The
selected chip carries four simultaneous differences:

1. a **check glyph** the unselected chips do not have (text, so it survives any
   palette),
2. a **bolder** label,
3. a **heavier border** (and in High-contrast, where every edge is already 2px
   black, the selected chip goes to 3px rather than collapsing the difference),
4. and only then a filled background.

Three of the four hold in a two-colour palette. The glyph slot is always rendered,
so selecting a chip moves no text.

### Keyboard behaviour is the platform's

Mode and density are native radio groups in a `fieldset`/`legend`, drawn as chips
through a radio input that is `opacity: 0` and **stretched over the whole chip**.
Stretched rather than clipped to a pixel because WCAG 2.5.8 measures the size of
the target, which is that input: a 1px-clipped input would be a 1px target with a
36px picture behind it. Native radios also mean roving tab order, arrow-key
traversal, the group name announced with each option, and the "N of 3" position
count all come from the browser. Font is a native `<select>`, which is also how the
registry's groups reach a screen reader for free.

### Without JavaScript the controls post a form

Task 053 hid the whole disclosure with a `<noscript>` rule, because a radio a
respondent can move that changes nothing reads as a broken page. That left a no-JS
respondent with a chain of cookie, then config, and **no way to set the cookie** -
and High contrast and the legibility faces (Atkinson Hyperlegible, Lexend,
OpenDyslexic) are the controls a respondent with scripting off or restricted is most
likely to need. Issue #195 closed that.

The same markup is now a real `<form method="post">` posting to `/appearance`
(`apps/portal/app/appearance/route.ts`), which validates the three values against the
same enumerations this page documents, writes the same three cookies through the same
writer the browser controls use (`appearanceCookie` in `apps/portal/lib/appearance.ts`),
and answers `303` back to the page the form came from. The next render is a server
render, so the choice is correct in the first byte.

The progressive-enhancement seam is one element wide: the **Apply** button. It is in
the markup always, hidden by CSS always, and revealed by the `<noscript>` rule in
`apps/portal/app/layout.tsx`. So the served HTML is one document either way, a
scripted respondent meets no hydration boundary and no layout shift, and with
scripting on the controls still apply on click with no round trip (the form's own
submit handler prevents the navigation that Enter inside the `<select>` would
otherwise cause).

Two limits are worth stating rather than discovering:

- **`?mode=` and the OS signals still need scripting.** They are resolved by the
  pre-paint script, so a no-JS respondent whose OS asks for `prefers-contrast: more`
  still gets the configured default and must pick High contrast themselves. The
  automatic contrast baseline (issue #28) is the CSS-level answer to part of that
  and needs no scripting at all: a media query runs whatever the respondent's
  scripting settings are, so a no-JS respondent on `prefers-contrast: more` still
  gets the stronger edges and rings, and one in Windows High Contrast Mode still
  gets the whole forced-colours treatment.
- **The redirect target is validated, never reflected, and never emitted relatively.** The
  return path (path and query) arrives in a hidden field, so it is respondent-controllable.
  It is accepted only when it resolves inside this origin, with the `Referer` (when that
  names the portal's own origin) and then `/` as fallbacks; the portal sends
  `Referrer-Policy: no-referrer`, so in practice the hidden field is what carries it. The
  check runs on the URL parser's OUTPUT, because normalisation rewrites `/..//host` into
  the pathname `//host` - a single leading slash in, a protocol-relative reference out. The
  `Location` is then built absolutely on the deployment's own base, so a path that somehow
  got past the first control still cannot name another origin. See
  `apps/portal/lib/server/appearance-form.ts` and `apps/portal/app/appearance/route.ts`.

The route carries SEC-9's CSRF belt like every other state-changing portal handler, so
the small population of browsers that send no `Sec-Fetch-Site` cannot use this form
either; a refused request is sent to the site root with nothing written, and the refusal
is visible only in the `origin.belt.refused` line (`beltOutcome: "redirect-to-root"`,
`docs/operations.md`).

### Measured: target sizes per density

`appearance.pw.ts` measures every rendered control target at all three levels
against WCAG 2.5.8's 24px minimum. At **Compact**, the tightest level: chips and
the disclosure 36px tall, the radio input itself 34px (inset by its border), the
font select 36px, a form option row 36px, the primary action 44px - every one at
least 77px wide. The smallest dimension anywhere in the sweep is 34px, against a
24px floor. The table is written to
`apps/portal/.playwright/appearance-target-sizes.txt`.

### Measured: the 1.4.12 floors hold at every density

The same spec sweeps **3 densities x all 23 registry fonts = 69 combinations** and
reads computed style each time. Every one is identical: body 16px, line-height 24px
(1.5), letter-spacing 1.92px (0.12em), word-spacing 2.56px (0.16em), vendored label
slot 16px, vendored hint slot 14px - the same numbers 052 measured per font at the
default density, unchanged by density, because the floors are carried by `--type-*`
tokens that a density level is forbidden to touch. Written to
`apps/portal/.playwright/appearance-floors.txt`.

Deployment-specific values that no predefined theme offers go in the single
documented override file, `apps/portal/app/adopter-theme.css` - never
`globals.css`, never a component. Overrides there sit outside the token test's
gate, so a deployment that changes colours checks its own pairs.

## Adding a theme

1. Author Light and Dark palettes (all 36 `--color-*` tokens) in the design
   deliverable, `plan/theme-palettes/`, and let `build.py` verify the pairs.
2. Copy the two blocks into `packages/ui/src/theme.css` as
   `:is(:root, [data-qcms-theme-scope])[data-theme="<key>"]` and
   `:is(:root, [data-qcms-theme-scope])[data-theme="<key>"].dark`, placed
   with the other alternates and **before** the High-contrast section. Every block in
   the sheet carries that anchor; a bare `:root` block would not reach a scoped
   container and `theme-tokens.test.ts` fails on one.
3. Add one `:is(:root, [data-qcms-theme-scope])[data-theme="<key>"].hc` block with the
   four accent tokens only, using an accent that clears 7:1 behind white.
4. Add the key to `PORTAL_THEMES` in `apps/portal/lib/server/theme.ts` and to
   `THEMES` in `packages/ui/src/theme-tokens.test.ts` and
   `apps/portal/e2e/theming.pw.ts`.
5. Run `pnpm --filter @roonga/qcms-ui test` (the ratios and the HC shape) and
   `pnpm verify:browser` (axe in all three modes).

## Verification map

| Claim                                                                                                | Test                                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Every pair meets its WCAG target, in every theme x mode                                              | `packages/ui/src/theme-tokens.test.ts` (computed from `theme.css`)  |
| Each 1.4.12 floor is a token and no mode lowers it                                                   | same file                                                           |
| HC is one layer plus a per-theme accent                                                              | same file                                                           |
| Selection resolves from config, including the typo path                                              | `apps/portal/lib/server/theme.test.ts`                              |
| Config reaches `<html>` and the computed style                                                       | `apps/portal/e2e/theming.pw.ts`                                     |
| The corner presets change controls, card and banner                                                  | same spec                                                           |
| The vendored controls really consume the spacing tokens                                              | same spec (moves each token and re-measures)                        |
| The floors hold on rendered text                                                                     | same spec                                                           |
| Every theme is axe-clean in Light, Dark and HC                                                       | same spec                                                           |
| Every control keeps a boundary, ring and state under `forced-colors: active`                         | `apps/portal/e2e/forced-colors.pw.ts`                               |
| `prefers-contrast: more` steps edges and rings onto the stronger token                               | same spec                                                           |
| The contrast blocks name only system colours and never `forced-color-adjust`                         | `packages/ui/src/theme-contrast.test.ts`                            |
| HC really is heavy borders, flat surfaces, heavy focus                                               | same spec                                                           |
| The rewrite moved no selector: each anchored form scores what its `:root` form scored                | `packages/ui/src/theme-tokens.test.ts`                              |
| The resolution is order-sensitive, so a mis-ordered sheet resolves wrong rather than being certified | same file                                                           |
| A scoped container resolves the portal colour AND geometry inside a differently-themed document      | `packages/ui/src/theme-scope.test.ts`                               |
| The treatment layer reaches controls inside a carrier and no `[data-rac]` control outside one        | same file                                                           |
| A density level sets only spacing tokens, never a type or colour value                               | `packages/ui/src/theme-tokens.test.ts`                              |
| `--space-control-h` clears 24px at every density, and the levels are monotonic                       | same file                                                           |
| The class names, cookie attributes and parsers the SSR path and the browser share                    | `apps/portal/lib/appearance.test.ts`                                |
| Density and brand resolve from config, including every typo path                                     | `apps/portal/lib/server/theme.test.ts`                              |
| A respondent cookie beats config, and a curated-away font cookie does not                            | same file                                                           |
| A logo the CSP could not load is dropped rather than rendered broken                                 | same file                                                           |
| Each control switches its axis, and the choice survives a reload via SSR                             | `apps/portal/e2e/appearance.pw.ts`                                  |
| A first visit defaults from `prefers-color-scheme` and `prefers-contrast: more`                      | same spec                                                           |
| The first PAINTED frame already carries the final appearance (no flash)                              | same spec                                                           |
| The selected chip differs by glyph, weight and border, checked in HC                                 | same spec                                                           |
| Every control target clears WCAG 2.5.8's 24px minimum at Compact                                     | same spec                                                           |
| The 1.4.12 floors hold at every density x every font (69 combinations)                               | same spec                                                           |
| The brand mark and `<title>` come from config, with no `QCMS` literal rendered                       | same spec                                                           |
| The panel is axe-clean in every mode x density, with the panel open                                  | `apps/portal/e2e/appearance.pw.ts`                                  |
| Without scripting the controls are hidden, and the config default still applies                      | same spec                                                           |
| A font-family list exists in exactly one place, on either surface                                    | `scripts/check-font-tokens.test.ts` (the gate, on the shipped tree) |
| Each tail names a CSS generic, with only symbol faces after it                                       | `packages/ui/src/theme-tokens.test.ts`                              |
| Every registry entry delegates its tail to a token rather than restating it                          | `packages/ui/src/font-registry.test.ts`                             |
| Body text resolves to the configured family plus exactly that tail, in a browser                     | `apps/portal/e2e/fonts.pw.ts`                                       |
| The submission reference resolves to `--font-mono`, not Tailwind's built-in stack                    | same spec                                                           |
| The condition editor's CodeMirror pane resolves to `--font-mono` too                                 | `apps/admin/e2e/forms-builder.pw.ts`                                |
| Every declared face is a real committed `woff2`, with no duplicate bytes                             | `packages/ui/src/font-registry.test.ts`                             |
| `fonts.css` is exactly what the manifest renders (add/remove is one entry)                           | same file                                                           |
| Every family is permissively licensed and its notice ships                                           | same file                                                           |
| A font entry sets `--font-portal` and nothing else                                                   | same file                                                           |
| Font curation resolves from config, System included, typos tolerated                                 | `apps/portal/lib/server/theme.test.ts`                              |
| Every shipped font actually renders, and zero requests leave the origin                              | `apps/portal/e2e/fonts.pw.ts`                                       |
| The 1.4.12 floors hold on rendered text under EVERY shipped font                                     | same spec                                                           |
| The Accessibility bolds are real faces, not synthesised                                              | same spec                                                           |
| Numeric controls take tabular figures from `--type-numeric`                                          | same spec                                                           |
