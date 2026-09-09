---
"create-qcms-app": patch
---

`pnpm qcms:sync-templates` now leaves `docs/ownership-seam.md` Prettier-clean.

The generator's `--write` mode hands the finished document to Prettier, with this
repository's own configuration, before writing it. A regeneration is therefore green
under `prettier --check` on its own, and the separate `pnpm format` step the recipe used
to carry is gone (issue #866).

`--check` is unchanged: it still runs under plain `node` in a tree that was never
installed, and still compares normalised content, so an already-formatted document
matches the compact block the generator renders.

The published tarball is unaffected. `scripts/` is not in this package's `files`, and
the generated tree under `templates/` is byte-identical; only the developer command that
derives it changed.
