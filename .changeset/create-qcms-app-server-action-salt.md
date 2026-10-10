---
"create-qcms-app": patch
---

Offer `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` as a portal-image build arg, so a scaffolded
project's no-JS respondent can hold a repeating step across a deploy (issue #1035).

`next build` salts every Server Action id with a key it generates per build, caches under
`<distDir>/cache/.rscinfo` for fourteen days and reuses for later builds in the same tree.
An image build is never the same tree, so every image renames every id, and a respondent
with scripting off who holds a step with a repeating group across a deploy then gets Next's
`409 Server Action unavailable.` on Add or Remove, losing the values typed into that step
since their last Continue. An in-place local rebuild keeps its ids, which is why none of
this is visible on a developer's machine.

The scaffolded `docker/portal.Dockerfile` now takes the key as a build arg scoped to the
build stage, `docker-compose.yml` passes it through for the portal service alone, and
`.env.example` carries the annotated entry with `openssl rand -base64 32` and no working
default. Leave it unset and the image behaves exactly as it did: Next generates a fresh key
per build. The scaffolded `app/s/[sessionId]/error.tsx` comment is corrected in the same
change, because it read the rotation as a framework law rather than as the deployment
choice it is.
