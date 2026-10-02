---
"@roonga/qcms-core": patch
---

Record which reading `stepViews` takes, and why (task 076).

No behaviour changes. Task 071 built the ADR-28 cursor's view list and left two edges to the task that owns the cursor; both are kept, and the reasons now sit beside the code instead of on a review thread. The list stays derived from the **roster**, so a rule hiding a member changes what an instance's page holds and never whether it exists: the cursor is a 0-based index into this list, so a list an answer could shorten would renumber the pages ahead of the respondent, which is exactly what ADR-28 forbids. And only the **first** `perInstanceStep` group in a step paginates it, which is the reading the API's cursor agrees with.
