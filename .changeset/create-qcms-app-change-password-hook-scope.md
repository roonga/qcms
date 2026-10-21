---
"create-qcms-app": patch
---

Correct the scaffolded API's account-update hook comment: better-auth's wrap around
`/change-password` is an async-local scope, not a database transaction.

Comment-only. `apps/api/src/features/auth/instance.ts` explained the
`databaseHooks.account.update.after` hook as running "after the commit", which reads as
a claim of atomicity the configuration does not make: no `transaction` option is passed
to `drizzleAdapter`, so the adapter advertises none, the adapter factory defaults the
flag to `false`, and `adapter.transaction` resolves to the as-is implementation that
hands the callback the adapter it already had. The two writes inside the wrap are
applied as they happen and nothing rolls back; what the wrap provides is the scope that
defers the hook until after the wrapped work succeeds, which is the ordering this flag
actually depends on. The reworded comment says that, with citations carrying `expect`
markers so the lines are re-read by `pnpm vendor:cite --expect`. The template is
generated from `apps/**` and the seam gate demands byte fidelity, so the correction
lands here too; nothing a scaffolded project runs changes.
