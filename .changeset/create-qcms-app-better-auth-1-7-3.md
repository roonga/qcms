---
"create-qcms-app": patch
---

Move the scaffolded API's exact `better-auth` pin to `1.7.3`, with the auth schema and
the `packages/db` migration the version needs.

1.7.3 stops writing the `account.issuer` column that 1.7.0 through 1.7.2 required, and
checks the generated Drizzle schema for columns it never writes, so a scaffolded project
that resolved 1.7.3 against the older schema failed `create-admin` before its first
scenario ran (issue #849). The template mirror now carries the new pin, and the schema a
scaffolded project migrates to is the one 1.7.3 expects.
