---
"@roonga/qcms-ui": minor
---

The renderer draws one instance for a per-instance step view (task 076, ADR-28 as amended 2026-09-29, ADR-43)

`presentation: "perInstanceStep"` paginates a step into one page per live instance, and the host says which page it is drawing: `RepeatExpansion` gains an optional `view`, a `{groupId, instanceId}` pair the API's step projection supplies. The expansion then clones the template for that one instance while naming it from its place in the **full** roster, so "Vehicle 2" is still Vehicle 2 on its own page, and counts `max` against the full roster too.

**The group's Add control is on the last view and on no earlier one**, expressed by withholding `addLabel` rather than by disabling the button: a disabled Add reads as "this group is full" to a respondent whose group is not. Every other group on the step is untouched by the narrowing, so a paginating group may sit beside a stacked one. No stored byte and no compiled prop changes, and a render passing no `view` is exactly what it was.
