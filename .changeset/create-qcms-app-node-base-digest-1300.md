---
"create-qcms-app": patch
---

Move the scaffolded Dockerfiles to the current `node:24-bookworm-slim` digest,
`sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`, in step with
the monorepo images. The tag is unchanged; only the digest the six `FROM` lines pin
moves, so a scaffolded project builds on the same base the repository's own images do.

The templates are generated from `docker/`, so this is the regenerated half of the base
image bump. Nothing else about what the scaffold produces changes.
