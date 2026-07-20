---
"@qcms/db": minor
---

Add a `@qcms/db/testing` subpath export exposing the Testcontainers harness
(`startTestDb`, `withTestDb`, `applyMigrations`, `TestDb`) so consuming
workspaces — the API app's live-DB integration tests (task 017) — can boot the
same throwaway Postgres the package's own tests use. The main `.` runtime
surface is unchanged: the harness stays a test-only, non-runtime surface (it
depends on devDependencies and points at source, run under Vitest), now reachable
without a deep relative import across the package boundary.
