# Gate 057 - option grid

Approve the rebuilt option list against the frozen card `plan/admin-theme/ds-option-grid.html`: **seven states** (rest, focus-revealed row controls, a cell editing, the row menu, the unnamed ghost row, a row mid-drag, the error row) at 390px and 1280px in light, dark and high contrast. 42 frames.

Every sentence below was written by opening the PNG it describes, not from what the CSS is supposed to produce. An earlier revision of this file described a rendering the frames did not contain, which is what sent the first attempt at this gate back.

The question this gate is really being asked is at the bottom. The rest is what to check on the way there.

## What the frames show

- **`grid-rest-*`** - four rows. The fourth label is long and **wraps across two lines** rather than truncating, and the row grows to hold it; the grip and the ID cell stay pinned to the first line. At 1280 the ID column is the card's 140px and the two long ids **ellipsize**: `opt_roadside_…` and `opt_i_have_re…`, with a real ellipsis character. At 390 there is no ID column at all: it folds to a second line inside the label cell, where `opt_roadside_assistance` fits in full and only the longest id (`opt_i_have_read_the_policy_…`) still ellipsizes.

- **`grid-row-focus-*`** - the second row's insert point, reached by focus with no pointer involved: the accent hairline, the circled `+` at its left, and a focus ring around the whole hotzone. The row below it shows its grip revealed at the same time. Both of these are opacity-0 at rest, so this frame is the one that proves focus reveals them.

- **`grid-editing-*`** - the second row's cell in its editing state: a bordered, focus-ringed field where the other rows are plain table text, with the caret at the start of the label.

- **`grid-menu-*`** - the row menu open on row 1's grip. Three items, each naming its row, so the danger item reads "Remove option Yes, always" in red rather than a bare "Remove". Every item wraps to two lines at this width, which is what the row-naming costs. **The menu is drawn in full, over the rows below it and past the grid's edge where it needs to be.** That is a fix in this revision: the grid used to clip it, and on a two-option list (what a new choice question seeds) "Remove option" fell outside the box entirely and could not be pressed with a mouse.

- **`grid-ghost-*`** - the ghost add-row opened and unnamed. An empty focused field, and the ID cell reads *Pending* in italics. This is the minting ruling on screen: the row exists and **no id has been minted for it**.

- **`grid-drag-*`** - new in this revision, and previously the one state the gate could not review: a row **mid-gesture**, held rather than dropped. Row 1 is lifted onto its own surface with a border and shadow and its grip lit, and the 3px accent indicator sits between "Roadside assistance" and the last row, marking where it would land. At 390 the lifted row keeps both of its folded lines (label, then id) inside the elevated box.

- **`grid-error-*`** - the third row's label cleared and saved. The cell wears a red border and a red-tinted fill, the other rows are untouched, and the message line sits **below the grid**, named by position: "Option 3: Option label needs at least one locale entry". The cell and that line are joined by `aria-describedby`, which is what makes the split placement acceptable rather than merely tidy; that join is asserted in the standing browser suite, not left to the eye.

High contrast is not a palette swap here. In `*-hc-*` every grip and every insert point is drawn at rest rather than waiting for hover or focus, and the grid's own edges thicken.

## The one decision this gate is asking for

**The 140px ID column at 1280, against ids that are now label-derived.**

The card drew that column for opaque ids (`opt_8f2ka91m`), which fit. The minting ruling keeps an id derived from the label it was first given, so a real one is `opt_roadside_assistance` and it does not. `grid-rest-light-1280` is the frame to judge it on.

What is and is not lost, because it narrows the question a long way: the ellipsis is **visual only**. The full id is real DOM text, so a screen reader reads all of it and so does anything copying the cell. The one person left short is a **keyboard-only sighted user**, who cannot recover the tail, because the interim fix puts the full id in the cell's `title` and a tooltip is pointer-only.

So: **widen the column, wrap the id onto a second line, or leave it as drawn.** That is the card's call and it was deliberately not taken in this task.
