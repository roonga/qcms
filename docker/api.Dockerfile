# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
# Frozen installs need every workspace manifest even when deploy prunes it from the runtime image.
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile
RUN pnpm --filter qcms-api... build
# --prod retains tooling supplied as optional peers; --no-optional keeps it out.
# Non-legacy deploy requires a workspace injection mode this repository does not use.
RUN pnpm --filter qcms-api deploy --legacy --prod --no-optional /opt/qcms

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="qcms-api" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/roonga/qcms"

WORKDIR /app
ENV NODE_ENV=production
# Append dependency bins so they cannot shadow system binaries used by the image or healthcheck.
ENV PATH="${PATH}:/app/node_modules/.bin"
COPY --from=build --chown=node:node /opt/qcms ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/serve.js"]
