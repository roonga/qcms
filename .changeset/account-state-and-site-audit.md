---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Task 088: account and membership state, and the site audit.

Migration 0011 adds `user.disabledAt`, `user.claimedAt`, `teamMember.suspendedAt` and
`teamMember.suspendedBy`, creates `control.site_audit`, and widens the `access_audit` kind
CHECK.

What an adopter should know.

- The disabled flag is read from the row on **every request**. Nothing caches a session, so
  a disable takes effect at once rather than at the next sign-in. A streamed response export
  reads it again before each page and stops mid-body when the account is disabled.
- A disabled or unclaimed account holds nothing, and a suspended membership grants nothing:
  `resolveMembership`, `listGrantsForUser` and `listMemberWorkspacesForUser` filter all
  three. The `member` row's Workspace administrator flag is not suspended, and
  administration lists still report a suspended holder so the state can be seen.
- `claimedAt` carries **no default**: `null` is unclaimed and holds nothing, so a create path
  that writes no claim leaves an unclaimed account. The migration marks every row it finds
  claimed, and `qcms:create-admin` writes the first administrator's claim itself. The
  account-creation act that writes an unclaimed account lands with the creation and claim
  work; nothing here writes `disabledAt` or `suspendedAt` either.
- A disabled account is refused on the **allowlisted better-auth endpoints** as well as on
  `/admin`: the mount reads the account behind the request's session, and no sign-in mints a
  session for one. Sign-in and sign-out are exempt from that read, since a cookie the browser
  still holds decides neither and a sign-out deletes only the session its own cookie names.
  An unclaimed account still reaches the endpoints that are its own claim (`get-session`,
  `change-password`, `two-factor/enable` and `two-factor/verify-totp`) and is refused every
  other endpoint it carries a session to.
- `POST /admin/workspaces` now refuses a first Workspace administrator who is disabled or
  unclaimed, with one answer for both.
- `control.site_audit` is the second append-only log: `actor`, `subject`, `workspace_id`,
  `kind`, `occurred_at`, `detail`, with four kinds (`account`, `administrator`, `approval`,
  `library`). `qcms_app_control` holds `SELECT` and `INSERT`; **no environment role holds
  anything on it**, because a site-level act is never performed on an environment pool; and
  `UPDATE` and `DELETE` are revoked from every `qcms_app%` role.
- `writeSiteAuditWithMirror` writes the site row and, for each workspace the act affects,
  one workspace-audit row, so a Workspace administrator sees what happened to their own
  workspace without reading the site log.
- `GET /admin/site-audit` is the read, for Site administrators only. No role reaches it.
- `access_audit` gains `group`, `administrator`, `approval` and `account`. A member added or
  removed stays `grant` and `revoke`.
