# syntax=docker/dockerfile:1
# Base image pinned by digest as well as tag (issue #372): the tag is what a human
# reads, the digest is what is actually pulled, so a rebuild months from now produces
# the same base rather than whatever `24-bookworm-slim` points at then. The `docker`
# ecosystem in `.github/dependabot.yml` moves the tag and the digest together, and
# records why pinning and that coverage had to land in one change.
FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build

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
# stage - the deploy step below prunes it - so this is the build stage paying for a
# complete workspace, exactly as `scripts` above does.
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile
RUN pnpm --filter qcms-api... build
# `--no-optional` is load-bearing, and `--prod` alone was not enough (issue #877).
#
# The image's SBOM used to list 680 npm packages, among them `vitest`,
# `@playwright/test`, `testcontainers`, `drizzle-kit`, `tsx`, `jsdom`, `next` and
# `react`. None of it runs here. It inflated the image and widened what every
# scheduled `pnpm audit` and SBOM scan reports on, which is the SEC-11 surface
# question rather than a functional defect.
#
# The cause was not a manifest mistake, and `--prod` was doing what it documents:
# "packages in `devDependencies` won't be installed" (pnpm 11.18.0, `pnpm deploy
# --help`; https://pnpm.io/cli/deploy). The deployed tree's top-level `node_modules`
# held production dependencies only. The tooling arrived one level down, through
# resolved OPTIONAL PEER dependencies: `better-auth@1.7.3` declares optional peers on
# `vitest`, `next`, `react`, `react-dom` and `drizzle-kit`, `next` declares one on
# `@playwright/test`, and `@roonga/qcms-db` declares them on `testcontainers` and
# `@testcontainers/postgresql` so a consumer can supply them for its `./testing`
# subpath. pnpm records every satisfied optional peer under that snapshot's
# `optionalDependencies` in `pnpm-lock.yaml`, and `--prod` prunes `devDependencies`,
# not `optionalDependencies` - so each install faithfully put the whole tree back.
# `--no-optional` ("`optionalDependencies` are not installed") is the flag that
# removes them: 388 virtual-store entries fall to 142.
#
# What it costs: a genuine optionalDependency of a production dependency goes too. In
# this closure that is exactly one, `pg-cloudflare`, which `pg` loads only when
# `net.Socket` is absent (a Cloudflare Worker) and never on Node. A future production
# dependency that needs an optional native accelerator would need this reconsidered
# rather than worked around.
#
# `--legacy` stays: pnpm 11's non-legacy deploy still refuses a workspace without
# `inject-workspace-packages=true`, which is a whole-workspace install-shape change.
# pnpm's docs note that requirement is gone from v12.2.0, so this is revisitable on
# the next major.
#
# `scripts/image-dev-deps.mjs` holds the boundary from the other side: the build reads
# the image's own SBOM and fails if it lists anything this workspace declares only as
# a devDependency, so a regression here is red before an image is pushed.
RUN pnpm --filter qcms-api deploy --legacy --prod --no-optional /opt/qcms

FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="qcms-api" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/roonga/qcms"

WORKDIR /app
ENV NODE_ENV=production
# So this image's dependency bins are runnable by name, which is what lets the
# `migrate` service call `qcms-db-migrate` instead of reaching into
# `node_modules/@roonga/qcms-db/dist/` past that package's `exports` map (issue #294).
# Appended rather than prepended: a dependency bin must never shadow a system
# binary this image or a healthcheck relies on.
ENV PATH="${PATH}:/app/node_modules/.bin"
COPY --from=build --chown=node:node /opt/qcms ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/serve.js"]
