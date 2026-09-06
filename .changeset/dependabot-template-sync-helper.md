---
"create-qcms-app": patch
---

Repository tooling only: the template generator now exports the reader for the
committed template tree, and its drift message points at the one command a Dependabot
bump needs (issue #834). The published tarball is unchanged - `files` ships `dist`,
`templates` and `src`, and `scripts/` is in none of them - so no template content and
no CLI behaviour moved. The changeset is here because a non-exempt file inside a
publishable package changed, which is the condition `check:changeset` guards.
