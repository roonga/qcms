---
"@qcms/db": minor
"@qcms/ui": minor
---

Dependency maintenance (Dependabot grouped minor/patch, 13 updates). Two of them
reach a published surface and are described individually below; the rest are
dev-scope or app-scope and change nothing a consumer resolves.

**`@qcms/db`: the optional-peer contract moves.** `testcontainers` and
`@testcontainers/postgresql` go from `^12.0.4` to `^12.1.0` in
`peerDependencies`, not only in `devDependencies`. Since #156 those two are a
declared part of this package's contract: the published `@qcms/db/testing`
subpath asks a consumer to install them, and the range in `peerDependencies` is
what tells the consumer's package manager which versions satisfy that ask. The
new range no longer admits `12.0.x`, so an adopter pinned there will see a peer
warning on their next install and should move to `12.1.0` or later. Both peers
remain optional, so a consumer who never boots a container is unaffected.

**`@qcms/ui`: `react-aria-components` `^1.19.0` to `^1.20.0`.** This is a runtime
`dependencies` entry, so it is code a consumer ships, not a build-time tool.
1.20.0 carries no API change this package uses, but it does change when
hydration adopts a server-rendered `Table` row: measured on the admin suite, a
row can report itself as `document.activeElement` for around 145ms before the
adopting re-render replaces the node. Code that focuses a row and immediately
acts on it, without waiting for react-aria's `data-focused` to appear, can act
on the pre-hydration node. That window exists under 1.19.0 too and is widened,
not created, by 1.20.0 (see `fix(admin): 419 retry the row focus until it
reaches the hydrated row`).

Minor rather than patch for both, on the same reasoning #156 used: a declared
dependency contract changed, and a consumer may have to act on it.

The other eleven updates are dev-scope or app-scope: `@types/pg`,
`@testing-library/user-event`, `axe-core`, `@seriousme/openapi-schema-validator`
and `typescript-eslint` on the test and lint side, and `next`,
`@codemirror/view`, `hono`, `@hono/node-server` and `better-auth` inside the
private apps, which are not published.
