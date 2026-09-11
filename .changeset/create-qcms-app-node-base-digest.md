---
"create-qcms-app": patch
---

Move the scaffolded Dockerfiles to the current `node:24-bookworm-slim` digest,
`sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`, in step with
the monorepo images. The tag is unchanged; only the digest the six `FROM` lines pin
moves, so a scaffolded project builds on the same base the repository's own images do.

The templates are generated from `docker/`, so this is the regenerated half of the base
image bump rather than an edit anyone makes by hand. It changes nothing about what the
scaffold produces beyond the Debian and Node patch level inside the base layer: same
tag, same two stages per image, same unprivileged `node` user, same port, same
environment.
