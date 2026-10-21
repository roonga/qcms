---
"@roonga/qcms-db": minor
---

Add `qcms-db-environment regrant`, so a restored backup comes back with the grants the
application needs and the ownership SEC-10 expects (issue #1094).

`pg_dump --no-privileges` carries no `GRANT` and no `REVOKE` - zero lines, against 39 in
the baseline migration - and the drizzle journal rides **inside** the dump, so a restored
database already reports every migration applied and re-running `migrate` grants nothing.
Since task 064 put every application grant in a migration, a restored database therefore
came back with `qcms_app_prod` holding no `USAGE` on `data_prod` and no `INSERT` on
`data_prod.sessions`: the first respondent write answered 500. `--no-owner` was the other
half, landing ownership of `control`, `data_<env>` and `reporting_<env>` on whoever ran the
restore, after which the environment command's ownership guard refused and a later
migration as `qcms_migrate` would have failed on objects it did not own.

The dump flags are deliberate and stay (Code Owner, 2026-10-22): a dump that named roles
would be coupled to one deployment's role names. So the restore procedure gains two
things instead. It runs as `qcms_migrate`, and it ends with one idempotent subcommand that
re-applies the whole grant model - the baseline's guarded grants, each environment's
grants, the control-schema grants including the `control.access_audit` grants and the
`qcms_app%` write revokes - for every environment in `control.environments`.

The model is now one ordered list of grant **sources**
(`packages/db/src/environment/grants.ts`) that the baseline, the environment command and
the subcommand all walk, so there is no second hand-maintained copy; a test fails if a
`GRANT` or a `REVOKE` appears anywhere in the migration tree that the list does not
produce. The subcommand needs only ownership of the QCMS schemas, prints no statement in
any error path (SEC-8), and cannot widen privilege:
`apps/api/e2e/security/04-db-restore-regrant.e2e.ts` takes a real dump, restores it, runs
the re-grant and compares the complete grant and ownership maps against the pre-dump ones
for equality. `pnpm qcms:drill-restore` makes the same comparison against the real images.

`StartedTestPostgres` gains `exec`, so a test can reach the container's own `pg_dump` and
`psql`.
