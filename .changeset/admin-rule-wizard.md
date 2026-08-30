---
"qcms-admin": minor
---

The rule editor is a three-phase wizard in a wide dialog (Code Owner, 2026-08-30).

When, Then show, and Test, behind a `tablist` rather than a stepper: nothing in the editor
is gated, so free movement between the three is the honest control, and the tabs pattern
already carries the roving tabindex and the "tab 2 of 3" announcement a hand-built stepper
would have to reinvent. The dialog takes the same 100rem cap the builder's own screen takes.

It BUFFERS. The Code Owner asked for explicit Cancel and Save, which is a save model rather
than two buttons, so nothing typed in the dialog reaches the draft until Save is pressed.
`plan/admin-design-contracts.md` §6 records the exception and its cost: while the dialog is
open the screen's autosave has nothing to save, so a long edit is unsaved work. It also
closes a hole, because "Add rule" now mints a rule rather than adding one, so an added and
then abandoned rule no longer leaves a targetless rule pausing the whole screen's autosave.

The targets are grouped by step with a filter over question ids, step ids and step names,
for the ten-step, several-hundred-question form the Code Owner named as the scale to design
for. The ineligible group is still listed and still labelled, which is what keeps a backward
target reachable. The test bench is also a phase of the wizard now, about the one rule being
edited, against the rule as it currently stands rather than as it was last saved. The rules
screen keeps its own bench as well; see the separate changeset for why both earn their place.
