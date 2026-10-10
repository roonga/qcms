---
"create-qcms-app": patch
---

Upgrade `perl-base` from `bookworm-security` in the runtime stage of each scaffolded
Dockerfile, in step with the monorepo images. Debian published `perl 5.36.0-7+deb12u4`,
which fixes five criticals against `perl-base` (CVE-2026-8376, CVE-2026-12087,
CVE-2026-13221, CVE-2026-42496 and CVE-2026-57433), and no published
`node:24-bookworm-slim` digest carries the fixed package yet, so a digest bump does not
reach them.

The templates are generated from `docker/`, so this is the regenerated half of that fix
rather than an edit anyone makes by hand. Nothing else about the scaffold changes: same
tag, same pinned digest, same two stages per image, same unprivileged `node` user, same
port, same environment. The layer runs as root before `USER node` and removes its apt
lists, and it carries its own removal condition: a scaffolded project should delete it
once a published base digest ships `perl-base` at or above `5.36.0-7+deb12u4`, which the
regular Dependabot digest bump will bring in.
