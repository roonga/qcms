---
"@roonga/qcms-db": minor
---

The published `@roonga/qcms-db/testing` subpath is now installable by consumers
(issue #156).

`@testcontainers/postgresql` and `testcontainers` were declared only as
**devDependencies**, which are not installed for consumers. An adopter who
installed `@roonga/qcms-db` and imported the documented entry point got
`Cannot find package '@testcontainers/postgresql'` - one package named, no
version, no remedy - even though the scaffolded-shell distribution model expects
adopters to write their own tests against their own database with exactly this
harness.

Both are now **optional peer dependencies**. They stay out of the default install
for consumers who never boot a container (promoting them to `dependencies` would
put a Docker client and its native build scripts into every runtime dependency
tree), and they remain devDependencies here so this workspace's own suites are
unaffected.

The harness also loads them lazily. `import { withTestDb } from "@roonga/qcms-db/testing"`
no longer throws when they are absent: the first `startTestDb()` call does, with a
message naming both packages, why they are optional, and
`pnpm add -D @testcontainers/postgresql testcontainers`. A genuine fault inside
either package is rethrown untouched rather than reported as a missing install,
and a missing peer is never described as a Ryuk-reaper or image-pull failure.

Minor rather than patch: this changes the package's declared dependency contract
and the behavior of a published entry point that previously could not be used at
all.
