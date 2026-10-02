---
"@roonga/qcms-a2ui-compiler": minor
---

A repeating group compiles to a `RepeatGroup` template node (task 073, ADR-42, ADR-43)

A step's item list may hold a repeating group, and an instance count is answer-dependent while `compileFormWith` is pure and answer-blind, so the compiler cannot expand one. It emits a `RepeatGroup` **template** carrying the group's member controls once, with the bare `questionId` as each `name`, and the renderer clones that template per live instance and qualifies each clone's name. The stored bytes are never touched, so ADR-18 holds exactly.

`RepeatGroup` is a qcms-owned node type on the `HONEYPOT_NODE_TYPE` precedent rather than an `@a2ra/core` registry component, so `COMPILER_VERSION` moves to `0.3.0` and opens golden generation `v4/` while `a2uiSpecVersion` stays where the pinned `@a2ra/core` package is. The seven existing corpus forms declare no group, so their compiled documents are byte-identical in the new generation and only the stamp moves; two repeat forms are appended beside them. The Add and Remove wording comes from a compiler lexicon frozen by `compilerVersion`, as the boolean Yes/No lexicon already does.
