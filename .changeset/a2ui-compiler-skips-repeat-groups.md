---
"@roonga/qcms-a2ui-compiler": patch
---

Carry the widened `Step.items` without emitting a repeat node yet (task 071).

A step's item list may now hold a repeating group (ADR-42), and the compiler
stays answer-blind, so it cannot expand one: the `RepeatGroup` **template** node
the renderer clones per live instance belongs to task 073, which is also what
moves `A2UI_SPEC_VERSION` and opens a new golden generation. Until then a group
contributes no node, and the seven committed golden documents are unchanged.
