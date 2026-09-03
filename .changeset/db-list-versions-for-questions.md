---
"@qcms/db": minor
---

Add `listVersionsForQuestions`: every stored version of many questions in one read
(issue #684).

`listQuestionVersions` answers this for one question, and calling it in a loop was the
only way to answer it for several. That loop was live at two layers at once. The API's
`GET /admin/questions` had no way to report anything but the latest version per row, so
the admin's form builder read the whole library and then issued one detail request per
question to assemble the version lists its question picker needs - `1 + N` HTTP calls on
every builder page load, with N the entire library and no limit, filter or pagination in
sight. Behind those N calls sat N more per-question queries.

The new query takes a list of ids, reads their versions with a single `IN`, and orders by
`(questionId, version)` so a caller partitions the result in one pass with every group
still oldest first - the order the detail route publishes and the order a version list is
read in. An empty id list short-circuits rather than issuing `IN ()`.

`listQuestionVersions` is unchanged and stays the right call for one question.
