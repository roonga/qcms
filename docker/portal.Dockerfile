# syntax=docker/dockerfile:1
# Base image pinned by digest as well as tag (issue #372): the tag is what a human
# reads, the digest is what is actually pulled, so a rebuild months from now produces
# the same base rather than whatever `24-bookworm-slim` points at then. The `docker`
# ecosystem in `.github/dependabot.yml` moves the tag and the digest together, and
# records why pinning and that coverage had to land in one change.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

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
# stage - Next's file tracing copies only what the server actually loads - so this is
# the build stage paying for a complete workspace, exactly as `scripts` above does.
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile

# Next's Server Action salt, and the one build input that decides whether a no-JS
# respondent survives a deploy (issue #1035, Code Owner 2026-10-10).
#
# `next build` hashes every Server Action id with a key it generates per build, caches
# under `<distDir>/cache/.rscinfo` for fourteen days and reuses for later builds IN THE
# SAME TREE. An image build is never the same tree, so every image gets a fresh key, so
# every image renames every action id, so a respondent holding a repeating step across a
# deploy posts an id the new build does not know and gets Next's `409`. Pin this and the
# ids survive: the held page's Add still runs, including across a build that changed the
# action's own implementation. `docs/deploy-ingress.md` has the operator's version and
# `scripts/probe-action-id-stability.mjs` is the measurement.
#
# Empty, which is the default here, is what Next treats as absent, so an operator who
# sets nothing gets exactly the behaviour this image has always had.
#
# **It is a secret, and pinning it does not put it anywhere it was not already.** Next
# writes the key it used into `.next/server/server-reference-manifest.json`, which the
# runtime stage copies, because `next/dist/server/app-render/encryption-utils.js` reads
# the key from that manifest when the environment does not carry it. So the key is
# recoverable from any portal image whether it is pinned or random; what pinning changes
# is that one image's key is then also every other image's. SEC-7 and SEC-8 carry the
# reading, including why the PUBLISHED `ghcr.io/roonga/qcms-portal` images must never be
# built with a shared one.
#
# It is scoped to the build stage and consumed inside the RUN below rather than promoted
# to an `ENV`, so no layer of the runtime image carries it and `docker history` shows the
# unexpanded name.
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=""
# The `pnpm --filter @roonga/qcms-db... build` prefix that used to lead this line is gone.
# It existed because Next type-checked the portal's E2E support files, which import
# @roonga/qcms-db even though the production portal has no runtime database dependency, and
# building that package was one way to satisfy them. The image now excludes `**/e2e`
# and `**/*.test.*` from the build context instead (.dockerignore), so those files
# are not in the image to type-check and the workaround has nothing left to fix.
RUN NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}" \
    pnpm --filter qcms-portal... build

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime

ARG VERSION=dev
LABEL org.opencontainers.image.title="qcms-portal" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/roonga/qcms"

# The one package Debian has fixed and no published `node:24-bookworm-slim` layer
# carries yet (issue #1047). Debian's `perl` 5.36.0-7+deb12u4 in `bookworm-security`
# closes five criticals against `perl-base` (CVE-2026-8376, CVE-2026-12087,
# CVE-2026-13221, CVE-2026-42496 and CVE-2026-57433), and the `Images` workflow's
# `scan` job blocks on them because they now have a published fix. The newest
# published base digest, built 2026-10-06, still installs 5.36.0-7+deb12u3, so a digest
# bump, which is the normal way a `deb` finding is cleared here, clears nothing. This
# layer is the narrowest thing that does.
#
# What it costs, stated rather than glossed: the image is no longer reproducible from
# the pinned `FROM` digest alone, because two builds of this commit on different days
# can install different `perl-base` revisions. That is the property the digest pin of
# issue #372 exists for, and `docs/SECURITY_DESIGN.md` section 9 lists this step as
# option 4 against exactly that cost. The cost is taken for one named package rather
# than a whole-image `apt-get upgrade`, and the scan job holds the floor that a hard
# `perl-base=5.36.0-7+deb12u4` pin would otherwise hold: if this package is ever behind
# a published fix again, the gate says so. A hard pin would instead break every build
# on the day Debian supersedes that revision, because `bookworm-security` publishes
# only the current one, and those builds include a scaffolded adopter's.
#
# Remove it, rather than carry it forward, as soon as a published base digest ships the
# fix. The check is one command:
#
#   docker run --rm node:24-bookworm-slim dpkg -l perl-base
#
# If that reports 5.36.0-7+deb12u4 or later, delete this layer from all three
# Dockerfiles, run `pnpm qcms:sync-templates`, and let the Dependabot `docker` digest
# bump carry the base forward on its own again.
RUN apt-get update \
 && apt-get install --only-upgrade -y --no-install-recommends perl-base \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Next's standalone `server.js` reads its bind address and port from the environment
# and defaults to `0.0.0.0:3000`; both are written here rather than left implicit so
# `docker inspect` answers what the process binds without anyone reading Next's source.
# This is the same contract the previous `next start --hostname 0.0.0.0 --port 3000`
# command line expressed, moved from argv to the environment because the minimal
# server takes no flags.
ENV HOSTNAME=0.0.0.0 \
    PORT=3000
# Next's own deployment output (`output: "standalone"`, apps/portal/next.config.ts).
# `next build` traces the modules the server actually loads and writes them, with a
# minimal `server.js`, under `<distDir>/standalone`. With `outputFileTracingRoot` at
# the workspace root that tree mirrors the monorepo layout, so the app lands at
# `apps/portal/` with one shared `node_modules` beside it, and nothing that only the
# build needed - the toolchain, the other workspace packages' sources, the whole
# `.next/cache` - comes with it. That is what replaced `pnpm deploy --prod` plus a
# copy of the entire `.next` directory here.
COPY --from=build --chown=node:node /workspace/apps/portal/.next/standalone ./
# The one thing tracing deliberately leaves behind. Next's documentation is explicit
# that the minimal server does not copy `.next/static` (or `public/`) into the
# standalone tree, because a CDN is expected to serve them, and that copying them in
# is how you serve them from the server itself - which is this deployment, since QCMS
# ships no CDN assumption. There is no `public/` directory in either front end, so
# this is the whole of it.
COPY --from=build --chown=node:node /workspace/apps/portal/.next/static ./apps/portal/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/portal/server.js"]
