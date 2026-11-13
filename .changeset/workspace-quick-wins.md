---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Workspace quick wins: a narrowed workspace list, rename, one add-member answer and archived settings.

- `renameWorkspace` changes an unarchived workspace's name and never its slug.
- `GET /admin/workspaces` lists only the workspaces the caller administers; the installation
  administrator gets every one.
- `PUT /admin/workspaces/{id}/name` renames a workspace, for its administrators and the
  installation administrator, and writes one `setting` audit row.
- Adding an account the caller cannot add answers one generic `ACCOUNT_NOT_ADDABLE` 404 on
  both the `email` and the `userId` path.
- An archived workspace refuses a settings change, as it refuses every grant, and still
  allows a revoke.
