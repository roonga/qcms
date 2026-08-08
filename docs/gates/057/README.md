# Gate 057 - option grid

Approve the rebuilt option list against the frozen card `plan/admin-theme/ds-option-grid.html`: six states (rest, focus-revealed row controls, a cell editing, the row menu, the unnamed ghost row, the error row) at 390px and 1280px in light, dark and high contrast.

Two things to look at deliberately:

- **`grid-ghost-*`** is the Code Owner's minting ruling on screen. The row exists and its ID cell reads "Pending" because nothing has been minted for it yet.
- **`grid-rest-1280`** shows the card's 140px ID column ellipsizing a real, label-derived id (`opt_roadside_ass...`). The card's mock ids were opaque and short; the ruling keeps them meaningful, so they no longer fit.

  What is and is not affected, because it narrows the question: the ellipsis is **visual only**. The full id is real DOM text, so a screen reader reads the whole of it, and so does anything copying the cell. The one person left short is a **keyboard-only sighted user**, who cannot recover the tail: the interim fix puts the full id in the cell's `title`, and a tooltip is pointer-only.

  So the decision is whether the column should widen, wrap, or stay as drawn. That is the card's call, deliberately not taken in this task.
