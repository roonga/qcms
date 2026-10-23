---
"create-qcms-app": patch
---

Move the scaffolded Dockerfiles to the current `node:24-bookworm-slim` digest,
`sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`, and delete
the `perl-base` upgrade layer, in step with the monorepo images. The tag is unchanged;
only the digest the six `FROM` lines pin moves, so a scaffolded project builds on the
same base the repository's own images do. The new digest resolves Node v24.22.1, which
clears the `>= 24.15` engine floor the workspace declares.

The templates are generated from `docker/`, so this is the regenerated half of the base
image bump rather than an edit anyone makes by hand. Nothing else about the scaffold
changes: same tag, same two stages per image, same unprivileged `node` user, same port,
same environment.

**The `perl-base` upgrade layer goes, and that is the point of this particular bump.**
The changeset for the previous digest recorded that the layer stayed because the base
still installed `5.36.0-7+deb12u3`. This digest installs `5.36.0-7+deb12u4`, which is
exactly the removal condition the layer's own comment named, so a scaffolded project is
once again reproducible from the pinned `FROM` digest alone: two builds of the same
commit on different days now install the same packages. Nothing is given up by deleting
it, because `apt-cache policy perl-base` in this base reports `5.36.0-7+deb12u4` as both
the installed version and the candidate.
