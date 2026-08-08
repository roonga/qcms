# Gate 057 - option grid

Approve the rebuilt option list against the frozen card `plan/admin-theme/ds-option-grid.html`: six states (rest, focus-revealed row controls, a cell editing, the row menu, the unnamed ghost row, the error row) at 390px and 1280px in light, dark and high contrast.

Two things to look at deliberately:

- **`grid-ghost-*`** is the Code Owner's minting ruling on screen. The row exists and its ID cell reads "Pending" because nothing has been minted for it yet.
- **`grid-rest-1280`** shows the card's 140px ID column ellipsizing a real, label-derived id (`opt_roadside_ass...`). The card's mock ids were opaque and short; the ruling keeps them meaningful, so they no longer fit. The full id is in the cell's tooltip. Whether the column should widen or wrap is a card decision, not this task's.
