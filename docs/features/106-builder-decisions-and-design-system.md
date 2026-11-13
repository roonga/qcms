# 106 - Builder decision bundle and design system

**Stage:** 9 (Phase 4) · **Apps/packages:** docs, `plan/`, the QCMS design system artifact · **Depends on:** the workspace access spec on `main`, with its theme, lock and derive rows (section 3)
**References:** `plan/agent-builder-decisions.md` (Q1 to Q21, W1, S1, "Security review requirements") · `docs/WORKSPACE_ACCESS.md` sections 3, 9 and 11 · `docs/features/041-agent-form-building.md` · `docs/features/049-admin-theme-editor.md` · `plan/work-order-sequence.md`

## Context

The builder rulings change ADRs and SEC decisions. This task writes them into the decision records before any builder code lands, so 107 to 121 build against recorded rules. Docs only: no code, no migration.

## Deliverables

W1, the decision bundle:

- `docs/adr/admin.md`: notes under ADR-19 and ADR-25 for Q1, Q2, Q13 and Q14 (the agent-first shell, the draft-scoped edit class, the parallel builder mode).
- `docs/adr/portal.md`: ADR-28 (portal rail, "Not needed", cursor back-jump; Q8) and ADR-30 (appearance on drafts and versions outside `FormDefinition`, Q4; per-theme high-contrast palettes, Q5; respondent controls, Q6; text-size compounding, Q9).
- `docs/adr/core.md`: ADR-41 scope note for workspace themes and the appearance lock (Q10).
- `docs/agent-principle.md` point 2 and SEC-17 in `docs/SECURITY_DESIGN.md`: Q14 to Q17 (card-less draft edits bound to a token and the draft revision, capped per turn, one audit row each; create as a Confirm card; publish through the wizard only; the tab-only conversation store).
- New SEC-18 in `docs/SECURITY_DESIGN.md`: Q7 as amended by Q19 to Q21, every fetcher requirement under "Security review requirements" (A4), its own default-off flag and optional egress allowlist or proxy (Q20), and no inheritance of the webhook `allowPrivate` switch.
- `docs/SECURITY_DESIGN.md` header count (SEC-1 to SEC-18) and a SEC-18 row in the section 10 control table; SEC-3 matrix rows for the theme, derive and lock acts (spec section 3); a SEC-9 check that the logo route keeps `img-src` same-origin; a SEC-15 note for the derive audit row and the lock `setting` row.
- `docs/features/041-agent-form-building.md`: the tool allowlist line ("Never: publish, erase, mint links, webhook config") and the "multi-turn memory beyond the session" line restated against Q14 to Q17.
- **049 supersede note:** `docs/features/049-admin-theme-editor.md` "Out of scope (binding)" gains a note that its per-form theming exclusion is superseded by agent-builder Q4 (appearance on drafts and versions) and by workspace themes (108 to 110, 116, 117). The ledger row already says so.
- `plan/admin-design-contracts.md` section 7: a recorded exception to the one-rail rule for the builder mode, as 7a does for Settings, and the departure from the ruled panel widths in `apps/admin/lib/agent/panel.ts`. The code change is 113's.
- `docs/form-publishing-flow.md`: the wizard's `returnTo`, limited to `/forms/<id>/build`, and the cumulative agent diff since the last human-reviewed revision (Q14, Q16).

S1, the design system:

- The QCMS design system artifact gains the TextSize card, the Appearance drawer with its locked state, the preview toolbar and the portal rail states (completed, current, ahead, "Not needed"). The PR links the artifact version.

## Exit criteria

Spec criteria owned: none. No criterion of `docs/WORKSPACE_ACCESS.md` section 14 is owned here.

- Every "Decision records to change" cell of the Q1 to Q21 table is written or stated as needing no change, in a PR checklist.
- SEC-18 lists every fetcher requirement that 110 tests, one line each, so 110's tests trace to it.
- No record contradicts the access spec's theme, lock or derive rows.

## Required tests

None beyond `pnpm verify` (docs only: dead links, vocabulary, formatting).

## Files and areas

`docs/adr/{admin,portal,core}.md`, `docs/SECURITY_DESIGN.md`, `docs/agent-principle.md`, `docs/form-publishing-flow.md`, `docs/features/041-agent-form-building.md`, `docs/features/049-admin-theme-editor.md`, `plan/admin-design-contracts.md`, `plan/agent-builder-decisions.md` (status line), the design system artifact.

## Migration

None.

## Gates

V (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round (ADR and SEC changes); Sonnet delta. Any record change the rulings do not already state goes to the Code Owner.

## Design gate

None. S1 is the design-system input to the builder design gates (113 to 120).

## Out of scope

Any code. The access spec rows. User-facing docs for themes and the builder (121).
