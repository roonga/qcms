HANDOFF: AWAITING-HUMAN Code Owner clears the 116 design gate for the settings additions and the drawer's locked state

Task 116 (U4 and U6) is claimed and unstarted. No product code is written, because the work order's design gate is only partly recorded.

## What the gate requires

`docs/features/116-appearance-drawer-themes-lock-settings.md`, Design gate: the Appearance drawer with its locked state and the settings additions, on the Agent Builder design canvas, seen by the Code Owner before dispatch.

## What is recorded

- The drawer: the Agent Builder canvas carries "Appearance drawer - theme list closed and open", "Builder - appearance is the admin's" and "Component - text size control states". Theme with the page tint checkbox, Face, Text size, Density, Corners, Progress and the read-only Respondent controls block are drawn, with Reset and Done in the footer.
- The text-size control's locked state is drawn: "Set by the workspace", every control disabled, the label saying why.
- The appearance lock switch on workspace settings is drawn on the Workspaces Area canvas (Settings-States, Screens-C) with its explanation and its disabled state for anyone who is not a Workspace administrator. Those boards are design batch 3, reviewed on 2026-11-16 per `docs/WORKSPACE_ACCESS.md` section 12.

## What is missing

1. Workspace themes on settings: list, create, rename, change, delete and the raster logo upload. No board on either canvas draws them. The settings boards show only a themes line ("Themes: Clinical blue, Clinical high contrast") and the two buttons 117 owns ("Derive from a website", "Save as workspace theme"), both disabled and marked "Ruled, not yet in the product".
2. `docs/WORKSPACE_ACCESS.md` section 12 records this row's artboard as "Agent builder canvas, to be confirmed", so the repository's own record says the design is unconfirmed.
3. The drawer's locked state as a whole. The work order asks for every control disabled with the reason and who can clear the lock; only the text-size control's locked state exists.
4. The contrast correction report in the drawer, worded when a choice fails contrast (107's report).

## Questions for the Code Owner

- Where is a workspace theme created? The settings boards offer no create control, and the drawer's "Save as workspace theme" belongs to 117. If that is the only creation entry point, 116's U6 is list, rename, delete and logo upload, and the work order's "create" needs correcting.
- Does the logo upload sit on the theme row on settings, or in the drawer?
- Is the drawer's locked state the text-size card's language applied to every control, with one reason line naming a Workspace administrator or Site administrator as able to clear the lock?

## State

- Branch cut from `origin/main` at a12e6b9bc. No source change, no test, no ledger row, no changeset.
- No API work is needed: 109 and 110 already ship list, get, create, update, delete, logo upload and the lock in `apps/api/src/features/workspaces/themes.ts`.
