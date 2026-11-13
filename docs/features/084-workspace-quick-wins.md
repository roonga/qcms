# 084 - Workspace quick wins

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api` · **Depends on:** the workspace access spec (`docs/WORKSPACE_ACCESS.md`) on `main`
**References:** `docs/WORKSPACE_ACCESS.md` sections 7 (directory visibility) and 9 · `plan/workspace-access-implementation.md` (quick fix Q1 and 084) · `plan/work-order-sequence.md`

## Context

Small API fixes that rest on rulings already recorded and need no new model. This task absorbs the workspace list fix (quick fix Q1; Code Owner, 2026-11-13), so there is no separate issue branch for it. If 084 slips, the Q1 fix ships alone from this work order.

084 touches `route-policy.ts`, so it merges before 085 starts on `policy.ts` or `route-policy.ts`; 085 then runs alone on both.

Green field: no data migration, upgrade path or backward compatibility (spec section 1).

## Deliverables

- **Workspace list (Q1):** `GET /admin/workspaces` returns only the workspaces in the caller's `grantContext.workspaceIds`; a caller holding the installation claim (the Site administrator after 086) gets all. The workspace switcher reads the same list.
- **Rename:** a rename route on the workspace that changes the name only, never the slug, and writes one audit row. Refused for anyone who is not an administrator of that workspace or the installation claim holder.
- **Generic add-member answer:** an unknown account gets the same status and body as an existing account the caller cannot add, on both the `email` and `userId` paths. 090 extends the same answer to disabled and unclaimed accounts.
- **Archived workspace writes:** `requireOpenWorkspace` on group delete, member remove and settings, so an archived workspace refuses every grant and still allows a revoke.
- OpenAPI regenerated; template mirrors synced.

## Exit criteria

Spec criteria owned: **26, 97, 98**. This task owns those and no others.

- Criterion 98 is built behaviour (archive refusal); this task adds the regression test on the route as it stands after the `requireOpenWorkspace` change.

## Negative tests

- A member of workspace A cannot list workspace B; the claim holder lists all.
- Unknown and existing-but-other answers are identical in status and body, on both paths.
- An archived workspace refuses a grant and allows a revoke.
- A non-administrator rename is refused; a rename never changes the slug.

## Files and areas

`apps/api/src/features/workspaces/{handler,route,schema}.ts`, `apps/api/src/features/membership/{handler,route-policy}.ts` (the rename row and the narrowed list), the switcher test in `apps/admin`, `docs/openapi/admin.json`, `apps/api/e2e/security/` (M).

## Migration

None.

## Gates

V, D, M (`plan/work-order-sequence.md`, Gates). M: `matrix-coverage.e2e.ts` and `01-authorization-matrix.e2e.ts` cover the rename route and the narrowed list.

## Review

Opus first round; Sonnet delta.

## Design gate

None. API only; the rename field is 099's.

## Out of scope

The new roles (085). The add-member answer for disabled and unclaimed accounts (090). Any admin screen.
