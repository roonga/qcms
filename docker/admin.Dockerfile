# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
# Frozen installs need every workspace manifest even when tracing excludes it from the runtime image.
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile
RUN pnpm --filter qcms-admin... build

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="qcms-admin" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/roonga/qcms"

WORKDIR /app
ENV NODE_ENV=production
# The standalone server reads its bind configuration from the environment, not command-line flags.
ENV HOSTNAME=0.0.0.0 \
    PORT=3000
# The workspace tracing root preserves monorepo paths while copying only the server dependency closure.
COPY --from=build --chown=node:node /workspace/apps/admin/.next/standalone ./
# Standalone tracing omits static assets for CDN deployments; this server must carry them itself.
COPY --from=build --chown=node:node /workspace/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/admin/server.js"]
