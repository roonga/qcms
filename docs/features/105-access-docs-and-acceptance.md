# 105 - Access docs and acceptance

**Stage:** 9 (Phase 4) · **Apps/packages:** docs, `apps/api` e2e, `create-qcms-app` e2e · **Depends on:** 084 to 104
**References:** `docs/WORKSPACE_ACCESS.md` section 14 · `plan/work-order-sequence.md` (criteria to tasks)

## Context

Closes the access programme: the docs say what shipped, and every criterion of spec section 14 traces to a test.

## Deliverables

- Built notes in `docs/WORKSPACE_ACCESS.md` (status table) and in the records of its section 15.
- `docs/environment-capabilities.md`; `docs/DEVELOPER_GUIDE.md` (email, the `qcms:create-admin` and `qcms:reset-2fa` break-glass path, adding an environment).
- `docs/workspace-access-guide.html` brought in line with what shipped.
- The final `apps/api/e2e/security/01-authorization-matrix.e2e.ts`: every role by act by environment, denials included; cross-workspace; an unauthorised actor on each administrative and site act.
- `packages/create-qcms-app/e2e/scaffolded-stack.e2e.ts` on the new model.
- A 1,000-account timing fixture.
- Each criterion of spec section 14 traced to its test, in `plan/work-order-sequence.md`.
- Ledger rows 084 to 105 closed.

## Exit criteria

Spec criteria owned: **1, 85, 111, 114**. This task owns those and no others.

- All suites run and listed in the PR.

## Negative tests

- Every blank cell of the section 3 matrix refused, by route.
- A site act affecting a workspace writes exactly one site row and one mirrored row.

## Files and areas

`docs/`, `plan/`, `apps/api/e2e/`, `packages/create-qcms-app/e2e/`, `docs/features/README.md`.

## Migration

None.

## Gates

V, D, B, E, M (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta. The docs sweep may be a Sonnet executor with its own docs-only review.

## Design gate

None.

## Out of scope

The builder's docs and acceptance (121).
