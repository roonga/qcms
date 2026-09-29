---
"create-qcms-app": patch
---

Scaffold templates carry task 061's provisional bootstrap credential (SEC-1).

A scaffolded app now ships the forced change-password screen and its route handler, the
better-auth `user.mustChangePassword` field declaration and the database hook that clears
it, the admin session gate that sends every route to that screen while the flag is set,
and the API middleware that refuses every admin route alongside it. Mirrored from
`apps/admin` and `apps/api` by `pnpm qcms:sync-templates`; no template was hand-edited.

A separate file from the `@roonga/qcms-db` changeset beside it, because `qcms-admin` and
`qcms-api` are private and this package is published on its own line.
