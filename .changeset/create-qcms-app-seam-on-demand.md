---
"create-qcms-app": patch
---

`docs/ownership-seam.md` no longer carries a generated inventory: `pnpm qcms:seam` prints it on demand, and `pnpm check:templates` checks the hand-written package table against the stamped manifests. The published CLI and templates are unchanged.
