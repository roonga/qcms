---
"create-qcms-app": minor
---

Carry `qcms:reset-2fa` into the scaffolding templates (issue #432).

A scaffolded project ships the same 2FA policy, the same encrypted-at-rest enrolment and
the same two-role Compose topology, so it has the same lockout and needs the same way
out. Leaving the command behind would scaffold a deployment whose only recovery is
hand-editing the database, which is the state issue #432 exists to end.

The adopter's recipe runs it on the `migrate` service rather than `api`, and that is the
guard rather than a detail: `migrate` is the one service in the generated
`docker-compose.yml` holding the migration credential, and the command refuses the
application credential the API runs as (SEC-10). The usage line the command prints is
rewritten to say so, on the same `ADOPTER_TEXT_REPLACEMENTS` seam that already rewrites
`create-admin`'s, and both scaffolded READMEs gain a lockout section.

The templates are generated from `apps/` by `pnpm qcms:sync-templates`, so this is that
sync rather than a second implementation.
