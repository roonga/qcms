---
"create-qcms-app": patch
---

Scaffolded API: run better-auth's multi-step auth writes in real database transactions
(Code Owner, 2026-10-22).

The generated `apps/api/src/features/auth/instance.ts` passed no `transaction` option to
`drizzleAdapter`, whose own default is `false`. The adapter factory then resolved
`adapter.transaction` to an as-is implementation that hands the callback the adapter it
already had, so better-auth's `runWithTransaction` wraps were async-local scopes and
nothing more: the writes inside them were applied as they happened and none of them rolled
back.

`POST /change-password` is the case that matters. Since better-auth 1.7.8 the library wraps
the session revocation, the credential write and the replacement session in one such wrap,
and a scaffolded deployment could therefore lose a password change part-way through: every
other session revoked while the old password still worked, or the password moved while the
caller was told the change had failed. The same flag also decides whether hooks queued
inside the wrap are drained when the wrapped work throws, so the forced-password-change
flag could be cleared by a change that did not take.

The option is now `true`, and the generated comment carries the reasoning with vendor
citations. A scaffolded project inherits the fix on its next generation; an existing one
adds `transaction: true` beside `provider: "pg"` in that file.

**This supersedes the other entry in this release** that describes the same wrap as an
async-local scope and the hook as ordered rather than atomic
(`.changeset/create-qcms-app-change-password-hook-scope.md`). That entry was accurate about
the configuration it found, and it is what prompted this one: the reason the wrap had no
rollback was a default nobody had chosen. Changesets are collated by filename rather than
chronologically, so read whichever order they print in as one correction followed by its
cause, not as two live claims.
