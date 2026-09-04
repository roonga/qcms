---
"@roonga/qcms-db": minor
---

Publish the migration command as a real entry point, and make its failures legible
(issue #294).

New consumer-visible surface: a `qcms-db-migrate` **bin** and a `./migrate`
**export**. Until now the only way to run the migration was
`node node_modules/@roonga/qcms-db/dist/migrate.js`, which is a filesystem path rather
than a resolution: it worked precisely by bypassing this package's `exports` map,
so a caller outside the package was pinning a `dist/` layout the package is
otherwise free to change. `docker-compose.yml` now runs `qcms-db-migrate`.

Every failure now exits `1` with a single `qcms-db migrate failed: ...` line on
stderr, the shape the missing-`DATABASE_URL` branch already used. A failing
migration previously surfaced as an `ERR_UNHANDLED_REJECTION` stack, because the
script had a `finally` and no `catch`. The line carries the driver's cause
(`ECONNREFUSED`, `password authentication failed`) and never the connection
string, which holds the database password.
