---
"create-qcms-app": patch
---

Ship `better-auth` as an exact pin, `1.7.2`, in the scaffolded API manifest, so a newly
scaffolded project installs the version this repository tests rather than whatever the
caret range resolves to on the day it is run.

The monorepo is protected by `pnpm-lock.yaml`; a scaffolded project has no workspace
lockfile, so it resolves the template's ranges fresh. better-auth 1.7.3 was published on
2026-09-06 and adds a startup check that refuses the Drizzle schema this repository
generates, so the first scaffold run after the 24-hour `minimumReleaseAge` hold lapsed
installed a library that would not start: `node dist/create-admin.js` exited 1 inside the
scaffolded stack and the scenario-1 loop never began (issue #849). A caret range on a
package whose startup behaviour is a function of the database schema is a range that can
break a stack nobody changed, which is the concern issue #125 raised about framework
packages generally.

Only the range moved. The resolved version is the one the lockfile already carried, the
auth schema is untouched, and better-auth pins its own `@better-auth/*` siblings exactly,
so the single pin fixes the whole family. Taking 1.7.3 deliberately, with the schema
migration it needs, is separate work.
