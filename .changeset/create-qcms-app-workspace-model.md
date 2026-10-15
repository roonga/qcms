---
"create-qcms-app": patch
---

Carry task 068 into the scaffolded app: the workspace routes, the publish-time pin rule and
the first-run workspace seeding.

A scaffolded deployment gets the same shape the repository has, because the template is a
mirror of `apps/` rather than a second implementation. What that means here: the
organisation plugin is configured with `isShared`, `requireSecondApprover` and `archivedAt`
as typed additional fields; `pnpm qcms:create-admin` creates the first workspace and
attributes it to the account it creates, with the two-person switch off; the admin API gains
the workspace list, the one creation path, the shared-library switch, the archive and the
two ownership moves; and publish refuses a new or moved pin onto a question another
ordinary workspace owns.

What an adopter should know: creating a form or a question now resolves an owning workspace.
A request that names none gets the installation's only workspace, which is the ordinary case
for a fresh scaffold, and is **refused** once a second workspace exists - there is no safe
default among several, and the picker arrives with the membership work. No organisation
route is reachable over HTTP: the auth mount's allowlist names none of the plugin's own
endpoints, so a workspace is created through the QCMS endpoint and nowhere else.
