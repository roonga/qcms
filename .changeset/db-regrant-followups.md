---
"@roonga/qcms-db": patch
---

Close the six findings the second review of the restore fix left open (issue #1094).

`qcms-db-environment regrant` wrapped every statement it ran but left three **reads** bare:
the live-set read, task 067's per-workspace reads and the `public` probe. Each is a fixed
query over no input, so none could carry a credential, but an unwrapped read hands drizzle's
`Failed query: <sql>` to the command's one-line error form, which made the documented
"prints no statement in any error path" falsifiable in one command. All three now run inside
the same wrapper the grants do, and the integration suite asserts what reaches stderr on a
failing **read** as well as on a failing statement.

The privilege map the restore gates compare for equality covered enum types only, so a
`CREATE DOMAIN`'s `USAGE` grant would have sat outside it. It now covers domains too. QCMS
creates no domain today, so this closes a latent gap rather than a live one; composite types
stay out deliberately, because every table has an implicit row type and admitting them would
repeat the relation rows once per table.

The SQL string-literal helper had three identical copies, one of them added by this issue.
There is now one, in `sql-literal.ts`, which imports nothing and is not part of the public
surface. `GRANT SELECT ON ALL TABLES IN SCHEMA reporting_<env>` gains a note where it is
emitted: it means the environment-wide pair only because it runs before the per-workspace
views exist, and a future reorder of `createEnvironment` would over-grant on the live path
(Code Owner, 2026-10-23, Q82). Also corrected: five stale or dangling internal references,
and the restore document naming step 2 for a revoke that step 6 re-applies.
