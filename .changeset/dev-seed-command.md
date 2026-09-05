---
"qcms": minor
---

Add `pnpm dev:seed`, which loads the sample question library into the stack `pnpm dev:up`
brings up.

The loader itself is not new: `apps/api/scripts/seed-fixtures.ts` has shipped since task
032, and the Questions screen's empty state tells a developer to run
`pnpm qcms:seed-fixtures` "against a development database". Nothing connected it to the
composed stack, and it could not be connected by hand: that stack's Postgres is
deliberately unpublished, so there was no `DATABASE_URL` to give it. The only route in was
to publish the port or bridge it, and `scripts/compose-config.test.ts` asserts that `api`
and `postgres` stay unpublished with the toolbox overlay layered on.

So the loader runs inside the Compose network, as a one-shot container built from the API
image, which is the one image whose dependency tree already carries `@roonga/qcms-core`,
`@roonga/qcms-db`, drizzle and `pg`. The service lives in `docker-compose.dev-tools.yml` behind a
`seed` profile, so `dev:up` neither builds nor runs it; `scripts/compose-seed.mjs` is the
sibling of `scripts/compose-admin.mjs` that knows how to invoke it, and carries the same
control over credentials: the database URL travels in the docker CLI's own environment and
never in an argv, because `/proc/<pid>/cmdline` is world-readable (issue #440).

Two other shapes were rejected, each for a reason already written down elsewhere in the
repository. A **bind mount of the checkout** would break the canonical dev-container seat:
Compose drives the host daemon (ADR-29), so a repository path resolves on the host's
filesystem where it does not exist, and Docker silently creates an empty directory there -
the same trap `dev-tools-role` carries its SQL inline to avoid. **Baking the loader into
the API image** would put a sample-data writer and the fixture corpus into the deployed
artifact, which `files: ["dist"]` currently keeps out.

Re-running is the expected second case and reports what it skipped, because the loader
leaves an existing question exactly as it is (R6).
