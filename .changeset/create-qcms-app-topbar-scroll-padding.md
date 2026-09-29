---
"create-qcms-app": patch
---

Carry the admin's two narrow-width accessibility fixes into the scaffolded app (issue #1011).

The generated admin's sticky top bar wraps below roughly 640px, so it stands about 145px
tall while `--admin-topbar-h` derives 57px - and that token is what `scroll-padding-block-start`
reserved, so a control the browser scrolled into view landed entirely behind the bar. That
is WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum, Level AA), and it is invisible to an axe
sweep, which measures a rendered page rather than what scrolling does to it. The scroll
padding now prefers a height measured off the bar, published by a new
`components/topbar-height.tsx`, and falls back to the derived token before the first
measurement. Nothing about the layout moved: scroll padding paints nothing.

The generated `app/globals.css` also adds the option grid's insert hotzone and row grip to
its `@media (any-hover: none)` block. Both are `opacity: 0` at rest and revealed by hover or
focus, so on a touch device an author saw neither the 14px insert target nor the grip that
opens the row menu - and that menu is the SC 2.5.8 Equivalent control the 14px target
conforms through, so the small target and its conforming alternative disappeared together.
