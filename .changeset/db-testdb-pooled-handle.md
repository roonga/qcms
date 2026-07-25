---
"@qcms/db": patch
---

`startTestDb()` (the `./testing` harness) now backs its Drizzle handle with a
`pg.Pool` instead of a single `pg.Client`, matching how the API builds its handle
in production. On a single client every concurrent `db.transaction()` shared one
connection, so overlapping transactions issued a redundant `BEGIN`/`COMMIT` pair
(Postgres logged "there is already a transaction in progress" / "there is no
transaction in progress") and silently shared one physical transaction, releasing
any `pg_advisory_xact_lock` at the first commit. `TestDb.client` is unchanged and
remains a dedicated connection for raw SQL; `teardown()` now also ends the pool.
