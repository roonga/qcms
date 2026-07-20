---
"@qcms/db": minor
---

Add `getForm` and `listForms`, two shape-preserving read helpers over the
`forms` identity table. The admin form-authoring slices (022) need to read a
single form by `formId` (detail, close/reopen, publish) and enumerate every
form for the library list, joining each against its draft/latest-version state.
Reads only - no business logic (R3, R5).
