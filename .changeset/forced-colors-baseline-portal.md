---
"qcms-portal": minor
---

The portal's own chrome under the automatic contrast baseline (issue #28).

Kept separate from `forced-colors-baseline` only because `qcms-portal` is an ignored
package and a changeset may not mix ignored with published ones; the component-kit half
of the same change, and the whole reasoning, is in that file.

Two media blocks at the end of `app/globals.css`, after the reduced-motion reset and
touching nothing above them. Under `forced-colors: active`: a `1px solid ButtonBorder`
edge on the Continue / Back / Start buttons, which are a fill with no border and so
flattened into plain text once the fill was forced to `Canvas`; a `CanvasText` edge on the
skip link, which was held off the content underneath it by a shadow and shadows are forced
away; the selected Appearance chip in `Highlight` / `HighlightText`, so the one control a
respondent uses to fix their own experience says "chosen" in the platform's vocabulary;
and `LinkText` for links inside the content column. Continue and Back are also the one
disabled control a respondent actually meets (`disabled={busy}` while a step is in flight,
faded by `disabled:opacity-50`, and opacity is not forced), so they take `GrayText` there
too. Under `prefers-contrast: more`: the
disclosure, the font select, the panel and the chips step onto `--color-border-strong` and
the chip's focus ring goes to 3px. The Apply button is deliberately left out of that list:
its border is `--color-primary`, which names the panel's one action rather than describing
an edge.

`lib/ui.ts` gains one non-Tailwind hook class, `qcms-chrome-button`, so a media query can
reach those three buttons. The fixes are colour decisions and belong in the stylesheet
with the rest of the block, not as variants inside a utility string.
