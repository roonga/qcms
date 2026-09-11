---
"create-qcms-app": patch
---

Ship `react` and `react-dom` as exact pins, `19.2.8`, in both scaffolded app manifests,
alongside the exact `next` pin, so a newly scaffolded project runs the React version this
repository tests the pinned Next against rather than whatever 19.x the caret range resolves
to on the day it is run.

The protection is asymmetric and that is the whole reason (issue #885). This repository is
held to a resolved version by `pnpm-lock.yaml`; a scaffolded project has no workspace
lockfile and resolves the template's ranges fresh from the registry, so `^19.2.8` let an
adopter install a React the monorepo never tested against `next` 16.3.4. That is the same
drift class issue #849 showed for better-auth and issue #125 closed for next. next 16.3.4's
own peer range is `^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0`, far too wide to
constrain anything, so the manifest is the only place the constraint can live.

Only the ranges moved, in `apps/portal` and `apps/admin` and therefore in the templates
generated from them. The resolved version is the one the lockfile already carried, no
resolution changed, and Dependabot still proposes React bumps through its weekly
`minor-and-patch` group.
