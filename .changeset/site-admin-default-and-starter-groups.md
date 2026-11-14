---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Task 086: Site administrator is an explicit role, and every new workspace has four starter groups.

- `control.user.role` loses its `admin` default and becomes nullable (migration 0009): a new
  account holds nothing. `makeSiteAdministrator` and `SITE_ADMINISTRATOR_ROLE` mark the one
  `qcms:create-admin` creates; `countSiteAdministrators` counts them.
- `insertWorkspace` and `starterGroups` create a workspace with its first Workspace
  administrator and the Authors, Publishers, Response viewers and Response erasers groups.
- `POST /admin/workspaces` takes an optional `firstAdministratorEmail`, which must name an
  existing account, and creates the workspace, that membership and the starter groups in one
  transaction with one audit row.
- `qcms:create-admin` makes the first account a Site administrator, Workspace administrator
  of the first workspace and a member of all four starter groups.
- A `qcms:create-admin` re-run on a deployment with no Site administrator and exactly one
  account, which `QCMS_ADMIN_EMAIL` names, promotes that account, seeds the first workspace and
  audits the promotion. With a Site administrator it is refused as before.
