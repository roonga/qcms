---
"@qcms/ui": patch
---

`@qcms/ui` gains an offline proof that its vendored `a2-react-aria` sources
still match upstream (issue #189, ADR-22).

`packages/ui/a2ra-manifest.json` records a sha256 of every file in
`src/components/a2ui/`, taken from the upstream registry at the commit
`a2ra.json` pins. `pnpm check:a2ra-fidelity` recomputes those hashes against
the working tree on every `pnpm verify` and in CI, without touching the
network, so a drift introduced by any earlier change is red rather than
invisible. Before this, `git diff` against `main` could only show that a given
branch had changed nothing.

The manifest is refreshed with the pin, in the same change, by
`node scripts/check-a2ra-fidelity.mjs --refresh`.

One comment in `src/components/schema/node.ts` loses an em dash. That file is
QCMS-owned source sitting beside the vendored tree, and the em dash gate had
never read it: four scanning gates excluded the whole of `src/components/`
rather than the vendored `a2ui/` subtree (issue #775). No runtime behavior
changes.
