# Gate: issue 517 - the pin list as the ownership grid

What to approve: that a reader of the step editor's pin list can tell, **without being
told, which of these values they can change here**. The form owns a pin's position and its
version and both are editable in this table; the question library owns the id, the label
and the type and none of them can be touched from a form. That contrast is design-language
element 4 and is the whole value of the change (`plan/admin-ux-audit.md` §8 item 5).

Every frame is shot at **390px and 1280px** (`-390.png` / `-1280.png`). Captured by
`apps/admin/e2e/gate-517.pw.ts`, which runs only with `QCMS_ADMIN_CAPTURE_GATE=1`. The
builder is navigated to at 390 before each frame rather than resized into it (issue #575).

| Frame | The clause it carries |
|---|---|
| `pin-grid-light` | **Element 4 plus contract §2's family.** The two form-owned cells (grip, version) carry a control with an edge; the three library-owned cells (question identity, type, issues) are plain text. Over the one table family: 44px rows, 0.72rem header on a 2px strong-border underline, 0.4rem/0.6rem cells, no zebra, `tabular-nums` on the Version column only. At 390: Type and Issues have dropped and **Version has not** (`plan/admin-mobile-stance.md` item 5), and the page does not scroll sideways. Also the identifying column, where this table **deviates from §2 deliberately** and says so in `components/forms/step-editor.tsx`: the `q_` id whole rather than the prefix plus 8 characters §2 asks for, monospace, with a copy control beside it and no ellipsis anywhere. Raised for a ruling rather than settled here. |
| `pin-grid-dark` | The same grid in dark. What is being checked is that the ownership contrast survives the mode: the version control's border and the grip both have to stay readable against the dark surface. |
| `pin-grid-hc` | The same grid in high contrast, where subtle backgrounds collapse and borders do the work. |
| `pin-grid-row-menu` | **Element 5, open.** The row's one control, carrying all five entries: insert above, insert below, move up, move down, remove. Insert above and insert below are what let a row-boundary insert affordance exist at all under WCAG 2.2 SC 2.5.8, and move up / move down are the single-pointer, non-dragging reorder path SC 2.5.7 asks for and the mobile stance puts on the supported-at-390 path. Every item names its own row. |
| `pin-grid-row-menu-first-row` | **Element 5 on the first row of the step, which is where the item order shows.** The same five entries, with **Move up dimmed in the middle position** because this row is already at the top, and Move down and Remove live beneath it. Approve the arrangement: a menu whose dead item is not at either end, which is the shape the option grid never has and which the roving-focus fix in this PR exists to make safe. Reachability of the two items below the dimmed one is not a claim this frame makes; `roving-red-first.txt` and the browser tests carry it. |
| `pin-grid-version-menu` | **R7, at 390.** The one version change the builder has, open at the width the mobile stance keeps it operable at. It offers other published versions of this one pin: no bulk move, no auto-upgrade. |
| `pin-grid-empty-step` | **Contract §3**, and its 2026-08-20 amendment: one panel for "nothing here yet", CTA-less because the creating action ("Add question from library") is already on the same screen. This retires the bare muted paragraph the step editor still carried after issue 514. |

## The one piece of evidence here that is not a frame

`roving-red-first.txt` is the pre-fix run of the three roving-focus tests this change
added. The split between it and the frames is worth stating, because each half is
worthless on its own.

**The frames own the arrangement.** `pin-grid-row-menu-first-row` shows the menu's item
order in the state that matters: Move up dimmed, third of five, with Move down and Remove
live below it. That a disabled item sits in the MIDDLE of this list, rather than at its
end the way the option grid's does, is the design decision a reviewer has to be able to
look at and agree with. `pin-grid-row-menu` (row 2 of 3) is the only-row-with-neither-move-
disabled case and cannot show it, which is why the first-row frame was added.

**The text file owns the behaviour.** Whether a keyboard can still reach Move down and
Remove once Move up is dead is not a property a still image has. It is asserted in
`apps/admin/e2e/pin-grid.pw.ts` and `apps/admin/e2e/questions-lifecycle.pw.ts`, and the
text file is those tests failing against the pre-fix component, so the assertions are known
to catch the defect rather than merely to pass.

## What is deliberately not in the set

**A drag in flight.** There is no drag on this table. Adding one would engage SC 2.5.7 and
would need a single-pointer alternative, and the only new control that provides one is an
editable position field, which the pattern this issue applies does not have. The menu's
move items are already that path, so a gesture would add a conformance obligation and no
capability. Reorder by keyboard (Arrow Up / Arrow Down on the grip) is preserved from the
previous editor and is covered by `apps/admin/e2e/pin-grid.pw.ts`.

**The grip at rest with no pointer over it.** It is visible at rest here rather than
revealed on hover as the option grid's card draws it, and the frames show that directly.
A touch screen has no hover, and this row's grip is the only route to remove, insert and
move, both of which the mobile stance puts on the supported-at-390 path.
