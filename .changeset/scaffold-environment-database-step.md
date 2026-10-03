---
"create-qcms-app": minor
---

Scaffold a database in the environment layout (ADR-40).

A fresh scaffold is the supported path onto the new `@roonga/qcms-db` baseline, so its
database step changes with it. The generated `docker-compose.yml` creates **four**
least-privilege roles rather than two - `qcms_migrate`, `qcms_app_control` and one
`qcms_app_<env>` per shipped environment - each with its own password, and grants nothing:
the grants belong to the migration that creates the tables they are on, so there is one
copy of the model rather than two to keep in step.

The generated `.env.example` carries the new keys: `QCMS_DB_APP_CONTROL_PASSWORD`,
`QCMS_DB_APP_TEST_PASSWORD`, `QCMS_DB_APP_PROD_PASSWORD`, `QCMS_ENVIRONMENTS` and one
`QCMS_DATABASE_URL_<ENV>` per environment. The generated API carries one connection pool
per environment beside a control pool, each connecting as its own role on its own search
path.

**An existing scaffolded project's database must be deleted and recreated**, like every
other QCMS database: the migration set is replaced rather than extended and applying it
over an earlier one is not supported. Drop the database, create it, and bring the stack
up; the `db-roles` one-shot and `migrate` do the rest in order.
