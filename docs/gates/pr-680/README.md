# Gate: issue 680 - the option grid reorders without dragging

What to approve: that an author looking at an option row's menu can tell **which way that
row can move, and when it cannot move at all**, without being told. Move up and Move down
are the single-pointer, non-dragging reorder path WCAG 2.2 SC 2.5.7 asks for beside the
grip's drag, and all three POCs (`plan/admin-shell-poc/admin-shell-poc.html`,
`settings-newquestion-poc.html`, `question-editor-poc.html`) draw them in this menu, in
this order.

The frame to look hardest at is `menu-first`: the option grid's dead item used to be
Remove, at the foot of the menu, and a dead item now sits in the **middle** of the list on
every first and last row. What is being judged is whether that reads as unavailable rather
than as broken.

Every frame is shot at **390px and 1280px** (`-390.png` / `-1280.png`), against a question
authored through the app. Captured by `apps/admin/e2e/gate-680.pw.ts`, one state per test,
which runs only with `QCMS_ADMIN_CAPTURE_GATE=1`. Each test asserts the disabled and
enabled states its caption claims before the shutter.

| Frame | What it claims |
| --- | --- |
| `menu-middle` | A middle row: five items in the order the POCs draw, both moves live, each naming its own row. |
| `menu-first` | The first row: **Move up dimmed in the middle position**, with Move down and Remove live beneath it. Reachability past the dimmed item is not a claim this frame makes; the browser test in `apps/admin/e2e/questions-lifecycle.pw.ts` carries that. |
| `menu-single` | A one-option grid: **three of the five dimmed** at once (both moves and Remove), with the two inserts still live, so the row is not a dead end. |
