---
"create-qcms-app": minor
---

Add `create-qcms-app`, the scaffolding CLI (task 037, ADR-05).

`pnpm create qcms-app my-forms` stamps the owned application shell (the api, portal
and admin composition roots, BFF handlers, theming, auth configuration, challenge
adapter and message catalogs) into an adopter's repository, referencing `@qcms/core`,
`@qcms/a2ui-compiler`, `@qcms/db`, `@qcms/ui`, `@qcms/observability` and `@qcms/csv`
by version. It prompts for the project name, deployment shape (solo or enterprise),
admin 2FA policy and the portal and admin base URLs, and takes every default under
`--yes` for a non-interactive run. The scaffolded project is a pnpm workspace and the
CLI offers no alternative (issue #449), because the shipped Dockerfiles prune their
runtime tree with a pnpm-only command.

It also stamps `docker-compose.yml` and the three production Dockerfiles, generates
`.env.example` from the API's own configuration schema, writes a `.env` with freshly
generated key material, initialises a git repository with a first commit, and prints
the exact next commands.

The templates are never hand-written: `pnpm qcms:sync-templates` derives them from
`apps/`, `docker/` and the configuration schema by a declared set of transforms, and
`pnpm check:templates` (inside `pnpm check:all`) fails when they drift.
