# syntax=docker/dockerfile:1
# Base image pinned by digest as well as tag (issue #372): the tag is what a human
# reads, the digest is what is actually pulled, so a rebuild months from now produces
# the same base rather than whatever `24-bookworm-slim` points at then. The `docker`
# ecosystem in `.github/dependabot.yml` moves the tag and the digest together, and
# records why pinning and that coverage had to land in one change.
FROM node:26-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
# `tooling/*` is a workspace glob too, so every manifest under it has to be here or
# `pnpm install --frozen-lockfile` refuses the workspace outright: a package that
# declares a `workspace:*` dependency on something the image never copied is not a
# missing file, it is an unresolvable graph. Nothing from here reaches the runtime
# stage - `pnpm deploy --prod` prunes it - so this is the build stage paying for a
# complete workspace, exactly as `scripts` above does.
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile
RUN pnpm --filter qcms-api... build
RUN pnpm --filter qcms-api deploy --legacy --prod /opt/qcms

FROM node:26-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="qcms-api" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/roonga/qcms"

WORKDIR /app
ENV NODE_ENV=production
# So this image's dependency bins are runnable by name, which is what lets the
# `migrate` service call `qcms-db-migrate` instead of reaching into
# `node_modules/@qcms/db/dist/` past that package's `exports` map (issue #294).
# Appended rather than prepended: a dependency bin must never shadow a system
# binary this image or a healthcheck relies on.
ENV PATH="${PATH}:/app/node_modules/.bin"
COPY --from=build --chown=node:node /opt/qcms ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/serve.js"]
