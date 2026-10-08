---
"@roonga/qcms-core": patch
---

A step that holds a repeating group is a visible step, empty roster or not (Q30, ADR-42)

Before this, such a step was **unreachable**, and the two halves held each other up: `visibleSteps` is derived from `visible`, so a step whose only content was a group had nothing visible while its roster was empty; the roster was empty because the mint is due on the first serve of the group's own step; and that step was never served because it was not a visible step. A form whose single step was a repeating group answered its very first request with `step: null` and `readyToSubmit: true`, before the respondent had answered anything, with no control that could change it. It affected the stacked, per-instance-step and table presentations alike.

A group's own chrome - its heading and its Add control - is content a respondent can act on, so holding a group is enough to list a step-visible step. `currentStep` moves with it, because it is nominated from `visible` and without that half every cursor-less serve still skipped the step: the unanswered fallback is now document-ordered over the visible steps, with a group-bearing step whose roster is empty counting as incomplete, so an earlier empty group wins over a later unanswered question. **Semantic 4 is untouched**: a step a step rule hides stays hidden, group or no group.

A form with no repeating group is unaffected - `visibleSteps` is its `visible` step set in document order exactly as before, and `currentStep` is the same first unanswered step. The one golden scenario that pinned the old reading was amended in place under the issue #128 defect-correction precedent, hash-pinned in the append-only guard and recorded in `CORPUS.md`.
