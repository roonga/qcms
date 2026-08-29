---
"qcms-admin": patch
---

Four things that were moving or misaligned (Code Owner, 2026-08-26).

**The page's scrollbar gutter is NOT reserved, and that was tried.** The form's own screen
scrolls and its Preview does not, so moving between them makes the scrollbar appear and
vanish and every column jumps sideways by its width. `scrollbar-gutter: stable` is the
standard fix and it is refused here: reserving the gutter takes the width out of the LAYOUT
viewport, so every breakpoint fires that much later than the window suggests. §1 fixes its
two boundaries in rem against the viewport and `e2e/rail.pw.ts` measures them to the pixel -
it wanted 1023 one pixel below the boundary and got 1008, and `measure.pw.ts` wanted a
1040px column and got 1025. Moving every boundary by a scrollbar to stop a jump between two
screens is the larger change, made silently. The reasoning is left in `globals.css` where
the next person to reach for it will find it.

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
