---
"create-qcms-app": patch
---

A cursor-less serve opens a group-bearing step rather than skipping it (Q30's serve consequence)

`currentStep` is frozen semantic 5, `firstMissingRequiredStep ?? firstIncompleteStep`, so a step holding a group whose roster is empty is only ever in the second tier: an unminted group contributes no visible question. A later step with a missing required answer therefore won the cursor-less first serve, and a fresh session on a group-first form opened on "Step 2 of 2" with a Back button to a step it had never seen, the group unminted, and Submit on a page the submission sweep then refuses with `REPEAT_COUNT_OUT_OF_RANGE`.

A cursor-less serve - the first serve of a session, and the no-JS path - now prefers the **earlier**, in document order, of two candidates: the view `currentStep` names, and the first view whose step holds a group this session has never opened. The kernel, `SEMANTICS_VERSION` and the golden corpus are untouched, and an **explicit cursor is never moved**, so Back and Continue behave exactly as before. Comparing the two candidates rather than ranking them in tiers is what keeps a form whose plain required question comes first from being skipped in the other direction.
