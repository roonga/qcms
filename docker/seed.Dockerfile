# The developer-toolbox seeding image: the sample question library, and a place to
# run the loader from that is inside the stack's network.
#
# ## Why an image at all, rather than a bind mount or a published port
#
# Two constraints rule out the obvious answers, and both are already written down
# elsewhere in this repository.
#
# **A bind mount would break the canonical developer seat.** ADR-29 puts a developer
# in a dev container that drives the HOST's Docker daemon over a mounted socket, and
# a bind mount is resolved by the daemon on the daemon's filesystem. The repository's
# path inside that container does not exist on the host, so Docker would silently
# create an empty directory there and node would find no script. `dev-tools-role` in
# `docker-compose.dev-tools.yml` carries its SQL inline for exactly this reason. A
# build context has no such problem: it is streamed to the daemon over the socket, so
# it works identically from a host checkout and from the dev container.
#
# **Publishing Postgres would break a tested control.** `scripts/compose-config.test.ts`
# asserts that `api` and `postgres` stay unpublished with this overlay layered on, so
# reaching the database from the host is not on the table. Being on the Compose
# network is.
#
# ## Why it starts from the API image
#
# The loader imports `@roonga/qcms-core`, `@roonga/qcms-db`, `drizzle-orm` and `pg`, and the API
# image already has all four under `/app/node_modules` - it is the one container that
# legitimately holds a database credential (ADR-35 as amended), so it is the one
# whose dependency tree is already the right shape. Starting anywhere else would mean
# a second install of the same packages.
#
# It is NOT baked into the API image itself, and that is the point of a separate
# file: `apps/api/package.json` ships `files: ["dist"]`, so the loader and the fixture
# corpus stay out of the deployed artifact. A production API image with a sample-data
# writer in it is a footgun nobody asked for.
ARG QCMS_API_IMAGE=qcms-api:local
# hadolint ignore=DL3006
FROM ${QCMS_API_IMAGE}

# THE LAYOUT IS THE REPOSITORY'S, and that is what lets the loader run unmodified.
# `apps/api/scripts/seed-fixtures.ts` finds its corpus at
# `new URL("../../../packages/core/fixtures/questions/valid/", import.meta.url)`, so
# the two only have to keep the same relationship to each other that they have in the
# checkout. Rooting that tree under `/app` is the other half: node resolves bare
# specifiers by walking up from the importing file, so `/app/seed/apps/api/scripts/`
# reaches `/app/node_modules` without a copy of its own.
COPY apps/api/scripts/seed-fixtures.ts /app/seed/apps/api/scripts/seed-fixtures.ts
COPY packages/core/fixtures/questions /app/seed/packages/core/fixtures/questions

# Inherited from the API image and wrong here: this container runs once and exits, so
# a healthcheck polling an HTTP server that was never started would report unhealthy
# for the second or two it lives.
HEALTHCHECK NONE

USER node
CMD ["node", "/app/seed/apps/api/scripts/seed-fixtures.ts"]
