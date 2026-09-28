---
"create-qcms-app": patch
---

Move the scaffolded Dockerfiles to the current `node:24-bookworm-slim` digest,
`sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`, in step with
the monorepo images. The tag is unchanged; only the digest the six `FROM` lines pin
moves, so a scaffolded project builds on the same base the repository's own images do.

The templates are generated from `docker/`, so this is the regenerated half of the base
image bump rather than an edit anyone makes by hand. It changes nothing about what the
scaffold produces beyond the Debian and Node patch level inside the base layer: same
tag, same two stages per image, same unprivileged `node` user, same port, same
environment. The new digest resolves Node v24.21.0, which clears the `>= 24.15` engine
floor the workspace declares.
