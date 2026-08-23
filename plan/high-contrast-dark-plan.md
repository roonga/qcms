# Plan: a dark variant of high contrast

**Status:** proposal, Code Owner direction 2026-08-19. **Affects the portal and the admin app**, because both read one mode model.

## Why this is not a small change

High contrast today is not a third palette. It is a **universal layer** deliberately
designed so that adding a theme costs almost nothing:

> "Pure #000 text and borders on #fff surfaces, flattened neutrals, fixed AAA semantic
> colours, one universal focus ring. A theme contributes ONLY its accent, so each theme
> keeps a whisper of brand while everything else is identical. **A NEW theme gets HC for
> free by adding one AAA-safe accent block.**"
> (`packages/ui/src/theme.css`, the block above `:is(:root, [data-qcms-theme-scope]).hc`)

That economy is the design's best property and the thing most at risk here. Four themes
ship today (harbor, plum, sand, slate) and each contributes four accent tokens to HC.
A careless split doubles that to eight per theme and doubles it again for every future
theme.

Three further facts constrain any approach, all verified in the tree:

- **The cascade is load-bearing and documented.** The shared `.hc` block is specificity
  0,2,0 and is emitted after every light and dark block, so it wins on source order;
  the per-theme accent overrides are 0,3,0 and win on specificity. The comment says so
  explicitly and notes ADR-38 moved both sides by exactly zero.
- **HC treatment is CSS, not tokens.** Heavy borders, flattened surfaces, suppressed
  shadows and the heavy focus ring live in `packages/ui/src/theme-components.css` under
  `[data-qcms-theme-scope].hc`, separate from the token values.
- **HC is never inferred.** `apps/admin/lib/appearance.ts` states that nothing derives
  high contrast from a media query, and that this is the point of listing it explicitly.

## The accessibility case, briefly

This is worth doing. A light-only high-contrast mode forces a real trade on people who
need both high contrast and a dark field: pure white at full contrast is a common
trigger for visual discomfort and migraine, and users with photophobia currently have to
choose between contrast and comfort. Offering only light HC means the mode does not
serve part of the group it exists for.

## Recommended shape: two independent axes, not a fourth mode

Model appearance as **polarity** (light or dark) crossed with **contrast** (normal or
high), rather than a flat list of four modes. This mirrors how the platform already
exposes the two ideas: `prefers-color-scheme` and `prefers-contrast` are independent
media features, not four values of one setting.

Concretely, the root class becomes a combination:

| Selection     | Root class        | Specificity of its token block |
| ------------- | ----------------- | ------------------------------ |
| Light, normal | (none) or `light` | bare `:root`                   |
| Dark, normal  | `dark`            | 0,2,0                          |
| Light, high   | `hc`              | 0,2,0                          |
| Dark, high    | `dark hc`         | 0,3,0                          |

**Why this shape rather than a flat `hc-dark` mode:**

- **`.hc` keeps meaning what it means today**, so existing light high-contrast
  behavior and tests stay valid. A flat fourth value would make `hc` ambiguous.
- **The universal-layer economy survives.** Dark HC is expressed as a second universal
  layer that overrides only the neutrals that must flip (text, background, surface,
  border). Semantic and accent tokens are inherited from the existing `.hc` block
  wherever they still pass at AAA on the new background, so a theme does **not**
  automatically need a second accent block. It needs one only where its existing HC
  accent fails against a dark field, which should be checked per theme rather than
  assumed for all four.
- **It composes.** A future third axis (density is already a portal control) does not
  require re-enumerating every combination.

**The cascade trap to get right.** `dark hc` at 0,3,0 ties with the existing per-theme
accent overrides `[data-theme=x].hc`, also 0,3,0. Ties resolve by source order, so the
emission order must be fixed and asserted, not left to whoever edits the sheet next:

1. light blocks
2. dark blocks
3. shared `.hc`
4. shared `.dark.hc`
5. per-theme `.hc` accents
6. per-theme `.dark.hc` accents, where any are needed

The existing sheet already documents its ordering as load-bearing. This adds two rows to
that argument and it should be written into the same comment, not a new one.

## What has to change

Nothing here is speculative: each item is a file that exists today.

**Token sheets**

- `packages/ui/src/theme.css`: a shared `.dark.hc` block, plus per-theme dark accents only
  where the light HC accent fails at AAA on the dark field.
- `apps/admin/app/theme.css`: the same, regenerated rather than hand-edited.
- `plan/admin-theme/tokens.css`: regenerated.

**Treatment sheet**

- `packages/ui/src/theme-components.css`: audit every `[data-qcms-theme-scope].hc` rule
  for polarity assumptions. Heavy borders and suppressed shadows are probably
  polarity-neutral; anything assuming a light field is not. This is an audit with a
  small expected diff, not a rewrite.

**Mode model, both apps**

- `apps/admin/lib/appearance.ts` and `apps/portal/lib/appearance.ts`: `MODES` becomes two
  axes. **A legacy cookie holding `hc` must parse to light plus high**, so nobody's saved
  choice changes meaning on deploy. That migration is the one piece with a correctness
  risk rather than a taste risk.
- `apps/portal/lib/server/mode-bootstrap.ts`: the pre-paint script stamps two classes.
- The admin has no pre-paint script and resolves the mode during SSR, so it stamps both
  classes in `app/layout.tsx`. The `prefers-color-scheme` media block in its token sheet
  applies only when no mode class is present, and that behaviour must be preserved.

**Controls**

- Both switchers become two controls (polarity, contrast) rather than three buttons.
  This is the visible half of the change and it is an improvement independent of dark HC:
  "Light / Dark / High contrast" already presents two different questions as one list.

**Gates**

- `plan/admin-theme/build.mjs` verifies every critical pair with the WCAG relative
  luminance formula and asserts AAA (7.0) for text on background in HC. **The matrix
  doubles.** The build must fail on a dark-HC pair below floor exactly as it does today,
  and the new pairs must be added to the same gate rather than checked by eye.
- `packages/ui/src/theme-tokens.test.ts` and the appearance and bootstrap tests in both
  apps.

**Artifacts**

- The eleven POCs under `plan/admin-shell-poc/` each carry a three-button switcher. They
  are proposals, not shipped code, so they can follow rather than lead, but they should
  be updated in one pass so they do not teach the old model.

## Sequence

1. **Decide the axis model** (this document's recommendation) before any code moves.
2. **Compute the dark-HC neutrals and verify them at AAA**, in `build.mjs`, before
   writing any sheet by hand. Contrast is computed here, never chosen by eye, and that
   discipline is what makes the existing HC layer trustworthy.
3. **Audit `theme-components.css`** for polarity assumptions.
4. **Sheets, then the mode model, then the controls.** The sheets can land inert: a
   `.dark.hc` block nothing selects yet changes no rendered pixel, which makes the risky
   part reviewable on its own.
5. **Cookie migration with its test**, then the controls.
6. **Regenerate the POCs.**

## Open questions for the Code Owner

- **Does every theme need a dark-HC accent, or only those that fail?** The recommendation
  is to check rather than assume, since "a new theme gets HC for free" is the property
  worth protecting. Whichever way this goes, it should be a stated rule so the next theme
  knows what it owes.
- **Is `forced-colors` in scope?** Windows High Contrast is a separate mechanism that
  overrides author colours entirely, and the app does not handle it today. It is adjacent
  to this work and often confused with it. The recommendation is to keep it out of scope
  and record that decision, rather than let it be assumed either way.
- **Does the portal's respondent control get both axes, or only the admin?** The portal's
  control is respondent-facing and its surface is deliberately small.
