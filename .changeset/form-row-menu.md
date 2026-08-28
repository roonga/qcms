---
"qcms-admin": minor
---

The form's row in the rail gets a menu, and Add step is in it (Code Owner, 2026-08-26).

With enough steps the control under them scrolls out of the rail; this one never moves. It
does not replace the one below, and that is the point of having both: **Add step appends**,
so the control beside where the new step appears is the one that matches what pressing it
does, and a control at the top that makes something appear at the bottom is a mismatch that
gets worse the more steps there are. Two ways in, each right for a different moment.

The menu is also where the form's other row-level commands will go when there are some.

One dialog, not two. The state lives in `RailSteps` rather than in either control, because
two dialogs would be two drafts of a step title, and which one you had typed into would
depend on which control you had reached for.

**The seven screens without the trigger reserve its width.** The builder's form row is now a
row of two controls, so its label has 30px less than the same row elsewhere; without the
reservation a long title would wrap at a different point on either side of a navigation and
move every row below it - the same defect the step rows were fixed for. Measured: every row
of a builder rail and a Preview rail at x=8 with matching heights.
