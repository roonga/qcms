---
"create-qcms-app": patch
---

Move the scaffolding templates to better-auth 1.7.10.

The exact pin in the `apps/api` manifest this CLI stamps goes from better-auth
1.7.7 to 1.7.10, so a newly scaffolded project installs the version this
repository resolves rather than drifting ahead of it.

The templates also carry the re-read better-auth citations from the canonical
apps, because a scaffolded project ships the same commented source: the
change-password hash, verify and account write in
`dist/api/routes/update-user.mjs`, `findCredentialAccount` and `updateAccount`
in `dist/db/internal-adapter.mjs`, and the after-commit hook queue in
`@better-auth/core`'s `dist/context/transaction.mjs` all moved under 1.7.8.
Comments only; no template behaviour changes.
