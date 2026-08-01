---
"@qcms/ui": minor
---

Widen the `@qcms/ui/kit` barrel with the four input primitives the QCMS question
editor needs: `Select`, `Checkbox`, `NumberField`, and `DatePicker` (task 032).

Nothing new was vendored. These are the same a2-react-aria sources the A2UI
renderer already maps question types onto; they were simply not reachable outside
the renderer's registry. Exporting them keeps ADR-22's single-stack rule intact:
an operator authoring a `number` constraint types into exactly the component a
respondent answers with, and no admin-only variant layer exists to diverge from it.
