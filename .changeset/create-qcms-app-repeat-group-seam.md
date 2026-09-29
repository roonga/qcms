---
"create-qcms-app": patch
---

Re-sync the vendored admin and API sources after the step-item union (task 071).

`Step.items` may now hold a repeating group (ADR-42), so a caller that wanted a
step's pinned refs asks `stepQuestionRefs` for them, and the admin's parallel
operator table carries the three whole-group operators that ADR-03's amendment
adds. Both are byte-identical copies of the canonical sources, which
`pnpm check:templates` holds them to.
