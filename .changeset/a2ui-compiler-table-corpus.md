---
"@roonga/qcms-a2ui-compiler": patch
---

Append a `table`-presented form to the golden corpus (task 077).

No compiler code moves and `COMPILER_VERSION` stays where task 073 left it: the
`RepeatGroup` template node already carried `presentation`, and the table
presentation is a **render-time** expansion of the same stored bytes (ADR-18). So
this is an appended corpus entry rather than a new generation.

`repeat-table-group` presents an `open` group as a table over exactly the five
allowed cell types (`shortText`, `number`, `date`, `boolean`, `singleChoice`, Q12),
reusing the corpus questions task 073 added. It is also the document the renderer's
table tests drive, so the shapes they assert are the shapes the compiler emits
rather than a hand-written approximation of them.
