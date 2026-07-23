# Memory index

- [I am the qcms product owner](role-qcms-product-owner.md) — standing goal: ship the Stage 8b launch gate without trading the three non-negotiables; Ravi holds ADR decisions and human gates
- [qcms project state](qcms-project-state.md) — repo locations, execution status snapshot, workshop mechanics; always re-verify ledger/git before relying on task status
- [Ravi's working preferences](ravi-working-preferences.md) — no AI trailers in commits, vendor-agnostic tooling, fast decisions on crisp recommendations, artifacts upfront
- [a2-react-aria repo notes](a2ra-repo-notes.md) — broken local turbo (use per-package gates), lint = Biome + lint:md, registry tripwires, rebase-merge preferred
- [qcms conductor traps](qcms-conductor-traps.md) — PowerShell path-token & $env gotchas; host-Windows only (N/A once on WSL/devcontainer, ADR-29)
- [qcms open decisions](qcms-open-decisions.md) — portal review findings now filed as issues #20-28; managed theming (ADR-30/task 047); devcontainer (ADR-29/task 046)
- [qcms design system](qcms-design-system.md) — Cobalt brand / Slate-Teal portal default; token contract in theme.css; "QCMS Design System" Claude Design project; ADR-26/30 (theming: modes/fonts/density/radius, font registry)
- [Filesystem scope boundary](filesystem-scope-boundary.md) — never read/edit local folders outside H:\source\agent3

_Note: this memory was migrated from the retired `qcms-plan` project (2026-07-23). The PO seat now runs from the qcms repo (`H:\source\agent3\qcms`); the qcms-plan folder is archived. Working/planning artifacts live in the repo's `plan/` folder; formal decisions in `docs/`._
