# Gate evidence - task 053 (respondent appearance controls + brand mark)

**Status: PENDING Code Owner sign-off.** This is the static-render screenshot gate
for the UI slice of ADR-30's launch tier. Nothing here has been approved.

Every image is a real render of the portal driven through the real harness
(Testcontainers Postgres, the composed API, the portal dev server, the kitchen-sink
fixture), captured by `apps/portal/e2e/gate-screenshots.pw.ts` at **390px** (phone,
the viewport that matters most - respondents are on phones, ADR-26) and **1280px**
(desktop). The Next dev-tools badge is removed before each shutter and running CSS
transitions are settled, so no frame shows a mid-transition blend (issue #187).

Regenerate the whole set with:

```
QCMS_PORTAL_CAPTURE_GATE=1 pnpm exec playwright test --project=mobile-chromium gate-screenshots
```

## What the harness is configured as

The suite deliberately runs on **non-default** config, so nothing in these images
could be a shipped default matching by coincidence: theme `harbor`, corners
`rounded`, default font `inter`, curated font list `atkinson, inter, merriweather,
jetbrainsmono` (plus System, which cannot be curated away), brand name **Northwind
Rowing Club**, and a small blue-grey square as the brand logo. Density is left at
the shipped Comfortable default.

## What to look at

| Question for the reviewer | Images |
| --- | --- |
| Is the default respondent view still minimal? Brand mark, progress, one collapsed control. | `form-comfortable-390` `form-comfortable-1280` |
| Does the brand mark read as the operator's, on a page with nothing else on it? | `entry-brand-390` `entry-brand-1280` |
| Does the panel read in each colour mode? | `panel-light-*` `panel-dark-*` `panel-hc-*` |
| **Can you tell which chip is selected without using colour?** Check glyph, bolder label, heavier border. | all `panel-*`, and especially `panel-hc-*` |
| Does each density look deliberate rather than accidental, with the panel out of the way? | `form-compact-*` `form-comfortable-*` `form-spacious-*` |
| Does the panel itself hold up at each density (it takes the density too)? | `density-compact-*` `density-comfortable-*` `density-spacious-*` |
| Does a font choice change the page's character without breaking the layout? | `font-atkinson-*` (Accessibility group) `font-merriweather-*` (serif) |
| Does the High-contrast treatment hold with a form AND an error banner on screen? | `hc-error-summary-*` |

## The set

| File stem | Shows |
| --- | --- |
| `entry-brand` | The form entry page: brand mark (logo + name), Start action, collapsed disclosure. |
| `panel-light` | The panel open, Light mode, Comfortable. Light is selected, so this is the selected-chip treatment against the default palette. |
| `panel-dark` | The panel open, Dark mode. |
| `panel-hc` | The panel open, High-contrast: 2px black edges on every control, 3px on the selected chip, flat surfaces, the theme's AAA accent as the fill. |
| `density-compact` / `-comfortable` / `-spacious` | The panel open at each density. The controls take the density too, so this is also the target-size check by eye (measured: 36px chips at Compact, against WCAG 2.5.8's 24px). |
| `form-compact` / `-comfortable` / `-spacious` | Each density **after a reload**, panel closed, so the form is unobstructed. The reload is the point: the persisted level is what the returning respondent's first paint carries. `form-comfortable` is also the default view. |
| `font-atkinson` | Atkinson Hyperlegible selected (the Accessibility group). |
| `font-merriweather` | Merriweather selected (a serif, so the change in character is obvious). |
| `hc-error-summary` | High-contrast with both required questions unanswered and Continue pressed: the error summary's HC treatment beside the controls. |

## Known interaction the reviewer should be aware of

`--space-section-pad` is a flat token (**issue #188, open**), so the step card has no
responsive padding and density is now a second multiplier over the same value. On a
412px phone the card spends 48px (Compact), 72px (Comfortable) or 96px (Spacious) of
width on padding. #188 is deliberately **not** resolved by this task. The direction
is worth noting while reviewing `form-compact-390`: Compact very nearly restores the
pre-051 phone padding (24px against the old 20px), so a respondent on a narrow
screen has a working escape hatch today.

## What is out of scope here

The admin theme editor (task 049), per-form theming, and the `forced-colors` /
Windows High Contrast Mode baseline (issue #28). Defaulting the mode from
`prefers-contrast: more` IS in these images' behaviour, but `forced-colors` is a
separate baseline and no image here shows it.
