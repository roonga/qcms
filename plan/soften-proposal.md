# Softening the admin's visual weight (ruled 2026-10-24)

**Status:** Ruled 2026-10-24 (Code Owner): all six decisions approved, including the 6 / 10 / 4 corners. Built by #1121.

**Ask (Code Owner, 2026-10-24):** the design reads as brutalist. Some fonts are too strong, and it is too much on the busy screens such as the question and form editors. Look at it across the whole app and soften it.

## What makes it heavy (measured)

- **Weight.** 34% of the text on the question editor is weight 600 or more (20% on the form builder).
  - `apps/admin/app/globals.css` has 24 rules at 600, 10 at 700 and one at 800.
  - Components use `font-semibold` 63 times.
  - The app sets `button { font-weight: 600 }` globally.
- **The face.** Lexend is wide, with large counters, so it reads about one step heavier than a neutral UI face at the same number. 600 in Lexend looks like 700 elsewhere.
- **Stacked boxes.** In the question editor a bordered `fieldset` ("Content", "Constraints") sits inside a bordered card. The builder stacks two bordered notices above its first field.
- **Solid grey secondary buttons.** "Publish and release…" and "Close in prod" are solid slate (`#97a2b8` in Dark) next to the cobalt primary, so three filled buttons compete in one row.
- **Two border weights.** Table headers and several panels use a 2px `color-border-strong` rule beside 1px hairlines.
- **Sharp corners.** The 4 / 8 / 2px scale (rev 4, "industrial") adds to the hard look on dense screens.

## The proposal

All of it is CSS and token values. No markup or component changes, and no vendored a2ra file is edited (ADR-22). The `font-semibold` remap and the button rule live in the admin's own sheet.

1. **One weight step down, everywhere in the admin:**

   | Element                                            | Today | Proposed                                                 |
   | -------------------------------------------------- | ----- | -------------------------------------------------------- |
   | `font-semibold` (headings, labels, card titles)    | 600   | 500                                                      |
   | `font-bold`                                        | 700   | 600                                                      |
   | Buttons                                            | 600   | 500                                                      |
   | Rail current row and summary                       | 700   | 600                                                      |
   | Table headers, tags, fieldset legends, question id | 600   | 500                                                      |
   | Wordmark                                           | 800   | 700                                                      |
   | Current nav item                                   | 600   | 500, plus the underline (it is still never colour alone) |
   | Body                                               | 400   | 400                                                      |
   - Heading tracking goes from -0.02em to -0.01em: Lexend needs less tightening at 500.
   - The page title goes from 20px to 22px, so hierarchy comes from size rather than weight.

2. **One border weight.** Every 2px `color-border-strong` rule becomes 1px in Light and Dark. High contrast keeps its 2px rules, which are what that mode is for.
3. **Fewer boxes.** A `fieldset` inside a card loses its box and becomes a titled group: its legend is the group heading, and there is no second border. Notices keep their tint but their edge becomes a `color-border` hairline, so the tint carries the tone.
4. **Tonal secondary buttons.** Secondary becomes `color-background-muted` with `color-text` and a hairline edge, instead of solid slate. Primary stays the one filled button in a row.
   - Contrast: text on the tonal fill is 15:1 or better in Light and Dark.
   - High contrast keeps today's solid secondary.
5. **Softer corners.** Adopt the portal's Subtle scale: `radius-control` 6px, `radius-card` 10px, `radius-sm` 4px. This reverses rev 4's sharp scale, which was a Code Owner direction (2026-07-30), so it needs its own ruling.
6. **Breathing room.** Line height in the content column goes from 1.5 to 1.55. Section gaps in the two editors go up one step.

Unchanged, on purpose:

- Lexend, the cobalt accent, all colour token values (except secondary), and every contrast pair.
- The 40px control height and the type floors.

## What it looks like

The prototype was applied live to `/questions/[id]` and `/forms/[id]`.

- **Question editor:** the title row, the "Version 2" tag and the "Save draft" button read as one calm line. The "Content" group no longer shows a box within a box.
- **Form builder:** the heading row shows one filled "Publish" with two quiet tonal buttons beside it. The rules lens's question names read at 500, not 600, so the sentence reads as a sentence rather than a list of bold fragments.

## Decisions needed

1. The one-step weight reduction, as tabled.
2. One border weight (1px) outside High contrast.
3. Unboxed fieldsets and hairline-edged notices.
4. Tonal secondary buttons.
5. Corners: move to 6 / 10 / 4 (reverses rev 4), or keep 4 / 8 / 2.
6. The small spacing increase in the editors.

## Build, once ruled

- **Order:** one issue, one PR, after the rail frame (#1116) merges, because both edit `apps/admin/app/globals.css` and the rail weights.
- **Files:**
  - `apps/admin/app/globals.css`: weights, borders, fieldset, notices, spacing.
  - `apps/admin/app/theme.css`: secondary and radius tokens. It is generated by `plan/admin-theme/build.mjs`, so change the generator and its contrast table, and keep `scripts/check-admin-theme.mjs` green.
- **Tests:** contrast is recomputed by the build. Visual regression and `verify:browser` apply.
- **Afterwards:** update the QCMS design system artifact (type styles, radius tokens, secondary colours, the Button card).

## Amendment, 2026-10-24 (Code Owner): SigPilot foundations

After a side-by-side with SigPilot (`roonga/sig-pilot`), the Code Owner adopted its foundations. **Inter and JetBrains Mono** replace Lexend. Dark takes the **navy ramp**. There are **no card shadows**. Corners are **4 / 6 / 2px, with 8px for modals** (the 6 / 10 / 4 scale above is withdrawn). The admin base text is **15px**. Titles, labels and buttons go back to **600**, which replaces decision 1 step-down above. Light keeps QCMS text colours. Decisions 2, 3 and 4 stand. The full record is on #1121.

## Amendment, 2026-10-24 (Code Owner): a 4px spacing scale and density rules

The scale is the whole vocabulary and nothing may sit outside it: `space-0-5` 2px, `space-1` 4px, `space-1-5` 6px (chips only), `space-2` 8px, `space-3` 12px, `space-4` 16px, `space-5` 20px, `space-6` 24px, `space-8` 32px, `space-10` 40px, `space-12` 48px. No padding or gap is derived from `em`.

- `admin-stack` becomes 8px and input inline padding becomes 12px.
- Density: one padding per card; 12px row padding; 4px from a title to its meta line and 8px from meta to the next block; 8px between buttons and 16px above a button row; no boxes inside rows.
- Weight 600 is only for the one title per block, labels, buttons and state words. Content lines and ids are 400.
- Fixed line heights: 15/22, 14/20, 13/18, 12/16, 11/16. Tailwind's `text-lg` is not a heading here: there is no 18px or 22px level.

## As built (#1121)

- The faces are self-hosted **variable** `woff2` files, which is what makes a 600 a real instance: `packages/ui/src/fonts/inter-variable.woff2` and `jetbrainsmono-variable.woff2` replace the two static 400 subsets in the registry, and `pnpm --filter @roonga/qcms-ui fonts:generate` rewrote `fonts.css` and the NOTICE.
- `border-strong` in Light is `#78819a` (3.89:1 on surface) rather than the `#838ca4` the amendment names: that is the value the design system carries, and it clears the 3:1 target by more.
- Dark `border-strong` is `#4f7396`. SigPilot's own `#3d6080` measures 2.91:1 on the dark surface, so it is not copied.
- The two weights are pinned as plain `.font-medium` / `.font-bold` rules rather than Tailwind `--font-weight-*` theme variables, because `scripts/check-font-tokens.mjs` reads every `--font-*` declaration as a family stack.
- `--radius-modal` reaches the kit through `--radius-lg` and `--radius-xl`, which are its menu and its dialog; cards stay on `--radius-md`.
- Elevation survives only on what floats: the account and row menus, the combobox popover, the dialog, and a dragged option row. `.qcms-card` and the respondent frame lost their shadows.
- Not in this PR: the per-screen title-to-meta and meta-to-block retuning on the question and form editors, which is screen work rather than a foundation.
