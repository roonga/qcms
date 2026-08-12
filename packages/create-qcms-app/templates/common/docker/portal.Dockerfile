# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps

RUN pnpm install --frozen-lockfile
# The `pnpm --filter @qcms/db... build` prefix that used to lead this line is gone.
# It existed because Next type-checked the portal's E2E support files, which import
# @qcms/db even though the production portal has no runtime database dependency, and
# building that package was one way to satisfy them. The image now excludes `**/e2e`
# and `**/*.test.*` from the build context instead (.dockerignore), so those files
# are not in the image to type-check and the workaround has nothing left to fix.
RUN pnpm --filter qcms-portal build
RUN pnpm --filter qcms-portal deploy --legacy --prod /opt/qcms

FROM node:24-bookworm-slim AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="qcms-portal" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/roonga/qcms"

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /opt/qcms ./
# pnpm deploy honours .gitignore, so Next's ignored production artifact must be
# copied explicitly after the pruned runtime tree.
COPY --from=build --chown=node:node /workspace/apps/portal/.next ./.next
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
