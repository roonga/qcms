---
"create-qcms-app": patch
---

Ship `next` as an exact pin, `16.3.4`, in both scaffolded app manifests, so a newly
scaffolded project runs the framework version this repository tests rather than whatever
the caret range resolves to on the day it is run.

The monorepo is held to a resolved version by `pnpm-lock.yaml`; a scaffolded project has
no workspace lockfile and resolves the template's ranges fresh from the registry, so
`^16.3.4` let the scaffold drift ahead of the monorepo. What makes that worse than a
version skew is what a Next.js minor can carry: issue #32 existed because a 16.x minor
deprecated the `middleware` file convention in favour of `proxy`, and a convention move
changes what the app's own source has to look like while announcing itself as a warning
rather than a failure (issue #125).

Only the range moved, in `apps/portal` and `apps/admin` and therefore in the templates
generated from them. The resolved version is the one the lockfile already carried, no
resolution changed, and Dependabot still proposes bumps through its weekly group.
