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
| `pin-grid-light` | **Element 4 plus contract §2's family.** The two form-owned cells (grip, version) carry a control with an edge; the three library-owned cells (question identity, type, issues) are plain text. Over the one table family: 44px rows, 0.72rem header on a 2px strong-border underline, 0.4rem/0.6rem cells, no zebra, `tabular-nums` on the Version column only. At 390: Type and Issues have dropped and **Version has not** (`plan/admin-mobile-stance.md` item 5), and the page does not scroll sideways. Also §2's amended identifying column: the `q_` id whole, monospace, with a copy control beside it and no ellipsis anywhere. |
| `pin-grid-dark` | The same grid in dark. What is being checked is that the ownership contrast survives the mode: the version control's border and the grip both have to stay readable against the dark surface. |
| `pin-grid-hc` | The same grid in high contrast, where subtle backgrounds collapse and borders do the work. |
| `pin-grid-row-menu` | **Element 5, open.** The row's one control, carrying all five entries: insert above, insert below, move up, move down, remove. Insert above and insert below are what let a row-boundary insert affordance exist at all under WCAG 2.2 SC 2.5.8, and move up / move down are the single-pointer, non-dragging reorder path SC 2.5.7 asks for and the mobile stance puts on the supported-at-390 path. Every item names its own row. |
| `pin-grid-version-menu` | **R7, at 390.** The one version change the builder has, open at the width the mobile stance keeps it operable at. It offers other published versions of this one pin: no bulk move, no auto-upgrade. |
| `pin-grid-empty-step` | **Contract §3**, and its 2026-08-20 amendment: one panel for "nothing here yet", CTA-less because the creating action ("Add question from library") is already on the same screen. This retires the bare muted paragraph the step editor still carried after issue 514. |

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
