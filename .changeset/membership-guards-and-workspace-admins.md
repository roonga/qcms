---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Task 089: membership guards and Workspace administrators.

What an adopter should know.

- **Every membership write in a workspace takes a per-workspace lock.**
  `lockWorkspaceMembership` takes a transaction-scoped advisory lock, in its own lock space,
  and every grant, revoke, group write and administrator change takes it first. The
  name-uniqueness check and the last-administrator count now sit inside it, so a
  check-then-write cannot interleave with another writer's.
- **The last-administrator guard counts active, claimed accounts only.**
  `listWorkspaceAdministrators` reports each Workspace administrator member row with whether
  the account behind it is active and claimed. Removing or demoting the last one that counts
  is refused with `LAST_ADMINISTRATOR` for every actor, a Site administrator included: that
  role never satisfies the guard. A disabled or unclaimed administrator satisfies nothing and
  is held by nothing.
- **A member row carries the administrator flag and a group row carries access roles.**
  `resolveMembership`, `listGrantsForUser` and `listMemberWorkspacesForUser` filter by row
  kind, so a `team.roles` entry naming `forms.owner`, or a member row carrying an access
  role, grants nothing and is not reported either.
- **New routes and audit kinds.** `DELETE /admin/workspaces/{id}/members/{userId}` takes a
  person out of one workspace: every access group they hold there and the member row, one
  revoke row each, with the account and every other workspace untouched. Appointing or
  removing a Workspace administrator writes an `administrator` row; a group created, renamed,
  deleted or re-scoped writes one `group` row naming both sides of the change, in place of
  the previous row per holder on a re-scope. A group delete still writes a revoke row per
  holder. Archiving a workspace writes a `setting` audit row. An administrator write that
  changes nothing, such as appointing an existing administrator or removing a non-member,
  records nothing.

No migration: the kinds this uses were added by `0011`.
