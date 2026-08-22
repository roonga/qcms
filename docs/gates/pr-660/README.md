# Gate: the add-question dialog selects several questions at once (issue 660)

Approve the add-question dialog against `plan/admin-shell-poc/add-question-poc.html`, which is the approved design. **That file holds two dialogs, not one:** its `@dsCard` subtitle reads "strict single-add vs multi-select", and a variant toggle switches between `#dialog-strict` (visible on load) and `#dialog-multi` (`hidden`). These frames are built to `#dialog-multi`, which is what issue 660 asks for.

| Frame | Viewport | What it claims |
| --- | --- | --- |
| `picker-390.png` | 390 | The dialog as it opens: a named checkbox leading each choosable row, the chosen pane already present reading "Chosen (0)", and a primary that says what the dialog is for without claiming a count |
| `picker-chosen-390.png` | 390 | **The change**, narrow: three ticked rows, the tally, each chosen pin named `questionId@version` with its own remove control, and "Add 3 questions to step" |
| `picker-1280.png` | 1280 | The same opening state at the standing wide width, with the Type column back that 390 drops |
| `picker-chosen-1280.png` | 1280 | **The change**, wide. Also carries the two refusals: the anchor row reading "Already in this form", and the withdrawn sibling reading "Version 2 of this question is chosen" |

## What a frame cannot show, and so is written here

**The result count, the pagination and the type/status filters the POC draws are absent on purpose, and the numbers in these frames come from a client-side array.** A running tally and a counted button look identical whether they were computed by a server or by `array.length`, so these frames are indistinguishable from the finished thing and must not be read as evidence that the picker matches its POC's data model.

The POC states as the premise of both its variants that they "assume a server-side search endpoint instead, with result counts, pagination and type/status filters shown as though they are server-driven". That endpoint does not exist: the builder loads the whole library on every page view and the dialog filters it in the browser. Building it is API and DB surface in a different seam and is filed as **issue 684**, which is the server-driven replacement for what these frames show.

## Departures from the drawing, each argued on `components/forms/library-picker.tsx`

- **One column, not two panes.** The POC's master-detail layout exists to flank a paginated server-driven list. This dialog is one column at every width the admin supports, so the chosen pane sits under the table.
- **One row per version, and no inline version select.** The shipped picker lists versions, so the row is the pin. The POC's rows are one per question with the version chosen inline, and its intro names the resulting "latest published version" default as the open question the file was drawn to settle, then never settles it. Keeping one row per version moots that question rather than answering it.
- **An unchoosable row carries no control**, where the POC draws a disabled checkbox. That rule predates this drawing and was argued on this screen: a disabled control is not reachable by keyboard and announces no reason, while the State cell says the reason in words.
- **The table scrolls so the footer does not move.** The counted primary is the point of the dialog, so it is placed by a height budget rather than by however many rows the library happens to have.

Captured by `apps/admin/e2e/gate-660.pw.ts`, one frame per test, so `--grep picker-chosen-1280` re-shoots exactly one.
