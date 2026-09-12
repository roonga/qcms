---
"@roonga/qcms-ui": minor
"create-qcms-app": minor
---

Honour `prefers-contrast: more` and `forced-colors: active` (Windows High Contrast Mode)
as an automatic baseline (issue #28).

This is not the operator-selectable High-contrast mode, and it is not gated behind managed
theming. It is what the portal does when the operating system says the person using it
needs more contrast, or has replaced the palette outright - no configuration, no respondent
action, and no scripting, because a media query runs whatever the respondent's scripting
settings are.

**What was actually broken under forced colours**, and none of it was visible to a reader
of the stylesheets. A Tailwind `ring-*` is a `box-shadow`, and forced colours delete every
box-shadow: the vendored text field, textarea and number field answered focus by giving up
their border (`focus:border-transparent`) in exchange for a ring that was never painted, so
a focused control had no boundary at all - it disappeared at the exact moment the
respondent was using it. The radio's dot, the date segment being edited and the focused row
of a listbox or menu are each a bare background fill, so forcing the fill to `Canvas` erased
the STATE and not only its colour: a chosen radio became indistinguishable from an unchosen
one. The portal's primary button is a fill with no border, so it flattened into plain text
on the page.

**`@roonga/qcms-ui`** gains two blocks at the end of `theme-components.css`, beside the
existing High-contrast scaffold. Under `forced-colors: active`: control edges restated in
`CanvasText` so they survive focus, the focus ring redrawn as a real `outline` in
`Highlight`, the radio dot in `CanvasText`, the edited date segment and the focused
listbox/menu row in `Highlight` / `HighlightText`, the number field's dividers and a menu
separator in `CanvasText`, and disabled controls in `GrayText` - the last one read off the
element react-aria marks rather than the one that draws the edge, because an option row's
`data-disabled` sits on its `label[data-rac]` root and its indicator child carries no state
at all. Under
`prefers-contrast: more`: control edges step from `--color-border` to
`--color-border-strong`, the higher-contrast half of one authored pair, already asserted
at 3:1 or better against every background - and the focus ring goes from 2px to 3px. That
includes the checkbox and radio indicator, which is the edge whose state lives on a
different element (react-aria keeps `data-selected` on the `label[data-rac]` root, so the
rule rides the label and the border rides its indicator child). The block moves no colour
VALUE, so no contrast pair and no WCAG 1.4.12 floor can be reached from it, and it leaves
alone every edge whose colour IS a state rather than chrome: an invalid control's
`--color-danger`, a chosen indicator's `--color-primary`, and the Apply button's.

A checked checkbox needed no rule: its tick is an SVG drawn in `currentColor`, which forces
to `CanvasText` inside a `Canvas` box. The radio has no glyph, which is exactly why it
needed one.

**No rule uses `forced-color-adjust: none`, deliberately.** Every colour in the portal that
carries meaning - selected, checked, focused, invalid, disabled - has a system-colour pair
that says the same thing inside the user's palette, so opting an element out of that palette
would only take the user's choice away. The case that would justify it is a swatch whose
exact colour IS the content, and the portal renders none.

The portal's own chrome takes the same two media queries in its own changeset,
`forced-colors-baseline-portal`.

**`create-qcms-app`** re-syncs both template twins.

Verified by `apps/portal/e2e/forced-colors.pw.ts`, which emulates both features in Chromium
and walks the kitchen-sink form: a drawn boundary on every control type plus the chrome,
a focused control that keeps its edge and gains a painted ring with the old shadow confirmed
gone, the radio dot / checkbox tick / selected chip each resolving to the system colour they
should, and axe clean throughout. Every comparison is against system colours resolved from
the live page, and each test first proves the palette is really forced (the body background
IS `Canvas`) so a run that only queried the media feature fails instead of passing
vacuously. `packages/ui/src/theme-contrast.test.ts` guards what the blocks may not contain.
