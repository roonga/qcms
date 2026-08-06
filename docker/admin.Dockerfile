# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm --filter qcms-admin... build
RUN pnpm --filter qcms-admin deploy --legacy --prod /opt/qcms

FROM node:24-bookworm-slim AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="qcms-admin" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/roonga/qcms"

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /opt/qcms ./
# pnpm deploy honours .gitignore, so Next's ignored production artifact must be
# copied explicitly after the pruned runtime tree.
COPY --from=build --chown=node:node /workspace/apps/admin/.next ./.next
# No `pg` alias fixup here any more. Turbopack used to assign a content-hashed external
# name to pg in the admin's server trace (for example `pg-4c0d…`), which is not a
# package pnpm can deploy, so each alias had to be symlinked to the real dependency.
# Task 056 removed the admin's database client entirely (ADR-35 as amended), so there is
# no `pg` in this image to alias.
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
