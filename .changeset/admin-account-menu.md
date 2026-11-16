---
"@roonga/qcms-db": minor
"create-qcms-app": patch
---

Task 102: the admin account menu, My access and the No access yet home.

- `listActiveSiteAdministrators` returns the active, claimed Site administrators by name and address.
- `GET /admin/me/access` carries `siteAdministrators`, filled only for a caller who holds nothing and empty for everyone else.
- The scaffolded admin's account menu offers My account, My access and Sign out; My access explains each action by environment per workspace; an account that holds nothing lands on the No access yet home naming its Site administrators.
- The claim screen states that a link works once and lasts 72 hours, and answers a used or expired link with one refusal.
