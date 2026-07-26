# Memory index

- [I am the qcms product owner](role-qcms-product-owner.md) - standing goal: ship the Stage 8b launch gate without trading the three non-negotiables; the Code Owner holds ADR decisions and human gates
- [qcms project state](qcms-project-state.md) — repo locations, execution status snapshot, workshop mechanics; always re-verify ledger/git before relying on task status
- [Code Owner working preferences](code-owner-preferences.md) - no AI trailers in commits, vendor-agnostic tooling, fast decisions on crisp recommendations, artifacts upfront
- [a2-react-aria repo notes](a2ra-repo-notes.md) - broken local turbo (host-Windows only; use per-package gates there), lint = Biome + lint:md, registry tripwires, rebase-merge preferred
- [qcms conductor traps](qcms-conductor-traps.md) — PowerShell path-token & $env gotchas; host-Windows only (N/A once on WSL/devcontainer, ADR-29)
- [qcms open decisions](qcms-open-decisions.md) - 2026-07-26 sweep: most findings resolved via ADR-31/32/33 + tasks 048-050; #53 (u/v patterns) still awaits the go
- [qcms design system](qcms-design-system.md) — Cobalt brand / Slate-Teal portal default; token contract in theme.css; "QCMS Design System" Claude Design project; ADR-26/30 (theming: modes/fonts/density/radius, font registry)
- [Filesystem scope boundary](filesystem-scope-boundary.md) - never read/edit local folders outside the parent folder holding the project checkouts (any machine/mount)
- [qcms PR flow](qcms-pr-flow.md) - two-seat PR-per-issue: dev loop opens with gate screenshots, this seat sweeps/merges via head-bound PO-REVIEW sentinels; idle ticks do docs/non-func work
- [PM pre-PR self-review gate](pm-pr-self-review.md) - diff-as-stranger + grep added lines for em dash / owner name / user paths; verify against rules, not gates

_Note: this memory was migrated from the retired `qcms-plan` project (2026-07-23). The PO seat now runs from the qcms repo checkout (`plan/` folder); the qcms-plan folder is archived. Working/planning artifacts live in the repo's `plan/` folder; formal decisions in `docs/`._
