# Stream fixtures in the build context: the host daemon cannot resolve dev-container bind paths.
# Run inside the private network without publishing Postgres; keep sample-data writers out of production.
# The API image supplies the loader's dependency tree.
ARG QCMS_API_IMAGE=qcms-api:local
# hadolint ignore=DL3006
FROM ${QCMS_API_IMAGE}

# Preserve repository-relative fixture paths while allowing Node to resolve /app/node_modules.
COPY apps/api/scripts/seed-fixtures.ts /app/seed/apps/api/scripts/seed-fixtures.ts
COPY apps/api/scripts/fixtures /app/seed/apps/api/scripts/fixtures
COPY packages/core/fixtures/questions /app/seed/packages/core/fixtures/questions

# This one-shot starts no HTTP server, so the inherited API healthcheck cannot succeed.
HEALTHCHECK NONE

USER node

# Keep subcommands replaceable without exposing the loader path to callers.
# Clear the inherited API CMD or it becomes loader arguments.
ENTRYPOINT ["node", "/app/seed/apps/api/scripts/seed-fixtures.ts"]
CMD []
