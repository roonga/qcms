---
"create-qcms-app": patch
---

Keep the scaffolded Next apps building with a plain `next build` (issue #925).

The two Next apps in this repository now build through `scripts/next-build.mjs`, which
waits out a second `next build` of the same app in the same checkout. That collision
takes two concurrent builds of one app, which is what a ten-lane agent workflow does to
one checkout and not what an adopter's project does, and the script it calls is not
stamped into a scaffolded tree - the Dockerfiles deliberately copy no `scripts/`
directory.

So the generator drops the wrapper from the kept `build` script the way it already drops
`clean-dist.mjs`, as one more entry in `APP_SCRIPT_FRAGMENTS`, and `assertNoEscapingPaths`
keeps proving no generated manifest reaches outside the app. **The templates themselves
are byte-identical**: a scaffolded `apps/portal` and `apps/admin` still declare
`"build": "next build"`, and `pnpm check:templates` passes without regeneration. This
entry records why the generator changed, not a change an adopter receives.
