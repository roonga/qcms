# 121 - Builder docs and acceptance

**Stage:** 9 (Phase 4) · **Apps/packages:** docs, `apps/api` e2e, `apps/admin` e2e, `apps/portal` e2e, `create-qcms-app` templates · **Depends on:** 106 to 120; for criteria 117 and 123 also 093 and 095
**References:** `plan/agent-builder-decisions.md` (S2, X2, X3, X4) · `docs/WORKSPACE_ACCESS.md` section 14 (criteria 117, 123) · `plan/work-order-sequence.md` (criteria to tasks)

## Context

Closes the builder programme: the docs say what shipped, the flows that cross tasks are proven end to end, the SEC-17 sentinel covers every new fact, tool and kind, and the two access criteria that need both appearance and the access work are tested.

## Deliverables

- S2 docs: `docs/theming.md` (per-form appearance, per-theme high contrast, text-size compounding), `docs/operations.md` and `docs/deploy-enterprise.md` (the SEC-18 flag, egress allowlist or proxy), `apps/portal/README.md`, `docs/agent-authoring.md` (the builder, card-less edits, what the agent cannot do), create-qcms-app templates.
- Cross-flow e2e: builder create, card-less edits, drawer, publish through the wizard with the diff, return to `/build`, the respondent sees the appearance in the portal; a derived theme saved and applied end to end.
- Sentinel sweep: the SEC-17 sentinel and vocabulary tests over every fact, tool and kind added by 111, 112 and 117, the derive output included.
- Each builder required test of `plan/agent-builder-decisions.md` traced to its test, in `plan/work-order-sequence.md`.
- Ledger rows 106 to 121 closed. If 119 or 120 slipped (Code Owner, 2026-11-13), their rows stay open and the cross-flow e2e covers what landed.

## Exit criteria

Spec criteria owned: **117, 123**. This task owns those and no others.

- All suites run and listed in the PR.

## Required tests

- Criterion 117: on a prod-only site with second approval on, a draft publish requested, then an appearance-only change: the approval is refused with the "draft has changed" message.
- Criterion 123: Move form carries appearance by value; after the move the draft and versions keep it; a destination lock refuses a later appearance edit, not the move; the Move form confirmation says so.
- Playwright (X3): drawer to publish to portal across the admin and portal stacks.
- Sentinel (X4): the full sweep above.

## Files and areas

`docs/{theming,operations,deploy-enterprise,agent-authoring}.md`, `apps/portal/README.md`, `apps/api/e2e/`, `apps/admin/e2e/`, `apps/portal/e2e/`, `apps/api/src/features/agent/` (sentinel tests), `packages/create-qcms-app/templates/`, `plan/work-order-sequence.md`, `docs/features/README.md`.

## Migration

None.

## Gates

V, D, B, E, M (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta. The docs sweep may be a Sonnet executor with its own docs-only review.

## Design gate

None.

## Out of scope

Access docs and acceptance (105).
