---
"@roonga/qcms-db": minor
"create-qcms-app": patch
---

Add the `link` kind to `control.access_audit` (migration 0014), so a respondent link mint or
revoke writes one workspace audit row in the act's own transaction (issue #1272).
