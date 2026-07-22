---
"@qcms/db": minor
---

Expose the started Postgres container on `TestDb` (the `./testing` harness) as
`container`, so a harness can stream the database server's logs for a test run
(task 045's portal e2e server-side log gate captures API + Postgres + portal
logs). Additive - `teardown()` still owns the container's lifecycle.
