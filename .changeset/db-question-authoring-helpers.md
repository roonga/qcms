---
"@qcms/db": minor
---

Add three shape-preserving question helpers the authoring slices (021) need:
`getQuestion` (identity + slug), `listQuestionVersions` (all versions of one
question, oldest first, for the detail view), and `updateDraftDefinition`
(overwrite a draft version's definition in place - the `question_versions`
freeze trigger backstops any attempt on a published version).
