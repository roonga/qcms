# syntax=docker/dockerfile:1
# Base image pinned by digest as well as tag (issue #372): the tag is what a human
# reads, the digest is what is actually pulled, so a rebuild months from now produces
# the same base rather than whatever `24-bookworm-slim` points at then. The `docker`
# ecosystem in `.github/dependabot.yml` moves the tag and the digest together, and
# records why pinning and that coverage had to land in one change.
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps ./apps
# `tooling/*` is a workspace glob too, so every manifest under it has to be here or
# `pnpm install --frozen-lockfile` refuses the workspace outright: a package that
# declares a `workspace:*` dependency on something the image never copied is not a
# missing file, it is an unresolvable graph. Nothing from here reaches the runtime
# stage - `pnpm deploy --prod` prunes it - so this is the build stage paying for a
# complete workspace, exactly as `scripts` above does.
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile
# The `pnpm --filter @qcms/db... build` prefix that used to lead this line is gone.
# It existed because Next type-checked the portal's E2E support files, which import
# @qcms/db even though the production portal has no runtime database dependency, and
# building that package was one way to satisfy them. The image now excludes `**/e2e`
# and `**/*.test.*` from the build context instead (.dockerignore), so those files
# are not in the image to type-check and the workaround has nothing left to fix.
RUN pnpm --filter qcms-portal build
RUN pnpm --filter qcms-portal deploy --legacy --prod /opt/qcms

FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime

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
