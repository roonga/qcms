# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
# Next type-checks the portal E2E support files, which import @qcms/db even
# though the production portal has no runtime database dependency. Build that
# package explicitly in a fresh Docker context before compiling the portal.
RUN pnpm --filter @qcms/db... build && pnpm --filter qcms-portal... build
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
