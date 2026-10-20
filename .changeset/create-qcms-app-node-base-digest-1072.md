---
"create-qcms-app": patch
---

Move the scaffolded Dockerfiles to the current `node:24-bookworm-slim` digest,
`sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5`, in step with
the monorepo images. The tag is unchanged; only the digest the six `FROM` lines pin
moves, so a scaffolded project builds on the same base the repository's own images do.

The templates are generated from `docker/`, so this is the regenerated half of the base
image bump rather than an edit anyone makes by hand. It changes nothing about what the
scaffold produces beyond the Debian and Node patch level inside the base layer: same
tag, same two stages per image, same unprivileged `node` user, same port, same
environment. The new digest resolves Node v24.22.0, which clears the `>= 24.15` engine
floor the workspace declares.

The `perl-base` upgrade layer stays. This digest still installs
`5.36.0-7+deb12u3`, so the condition its comment names for removal, a published base
that already carries `5.36.0-7+deb12u4` or later, is not met yet.
