---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Bring second approval in line with the workspace access spec (task 093).

- Turning second approval on is refused where nobody else could approve; turning it off, and a
  self-grant of a response role or a new environment for one, are held as workspace approval
  requests decided by another Workspace administrator or a Site administrator.
- On a site whose only environment is `prod`, a draft publish to `prod` under second approval is
  held as a request bound to the draft's revision and content, frozen and published on another
  Publish forms holder's approval.
- `listActiveRoleHolders` and the `target`, `kinds` and `excludeKinds` filters on
  `listApprovalRequests` are new in `@roonga/qcms-db`; a self-grant request payload may also bind
  the name and the sets a group edit replaces.
