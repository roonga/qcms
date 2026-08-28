---
"qcms-admin": patch
---

Four things that were moving or misaligned (Code Owner, 2026-08-26).

**The page reserves its scrollbar gutter.** The form's own screen is long enough to scroll
and its Preview is not, so moving between them made the scrollbar appear and vanish and
every column jumped sideways by its width. Nothing on either screen had moved: the viewport
had. `scrollbar-gutter: stable` on `html`. The cost is paid on every screen - a page that
does not scroll reserves the gutter anyway - which is the trade `overflow-y: auto` on the
rail deliberately did NOT make, a permanent gutter inside a 240px rail being a tenth of it.
It does nothing where scrollbars are overlays, which is why the headless browser the suite
runs in cannot see this and a desktop can.

**Rail rows centre their label.** `align-items: baseline` was right while a row was as tall
as its text; since these rows took the control height it left the label sitting high in its
own box, which shows the moment a row is current and has a background to be off-centre
inside. Measured: 10px above and below on every kind of row.

**The steps lose their rule and their indent.** A line down the left and an inset both said
"these belong to the row above". The ordinal says it - "1.", "2.", "3." is not something a
section row has, and it sits exactly where an indent would have been - and two more devices
saying it cost a 240px column the width of a step's title twice over. Nesting is still
carried structurally, by an `<ol>` inside the row's own `<li>`, so a screen reader announces
the level whatever the paint does. Measured: every row of both a builder rail and a Preview
rail now starts at x=8, at matching heights.

**A long form title clips on the span, not the row.** `text-overflow` acts on a block
container's inline content, and these rows are flex containers whose children are flex
items, so on the row it did nothing; `min-inline-size: 0` is the other half, since a flex
item will not shrink below its content without it.
