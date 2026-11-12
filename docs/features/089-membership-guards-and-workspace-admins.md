# 089 - Membership guards and Workspace administrators

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `@roonga/qcms-db` · **Depends on:** 085, 088
**References:** `docs/WORKSPACE_ACCESS.md` sections 3, 10 and 11 · `plan/workspace-access-implementation.md` (089) · `plan/work-order-sequence.md`

## Context

The guards that keep a workspace administrable, the Workspace administrator acts, and the audit rows for every workspace and group act.

## Deliverables

- A per-workspace lock around every membership write.
- The last-administrator guard counts active, claimed accounts only and never the Site administrator role.
- Appoint and remove Workspace administrator routes; a remove-member route.
- Audit rows for group create, rename, delete, roles or environments change, member add or remove, administrator appoint or remove.
- **Agent kinds:** the membership kinds use the lock and the guards, and every kind on a route this task changes follows the new matrix.

## Exit criteria

Spec criteria owned: **21, 23, 25, 86, 87, 88, 89**. This task owns those and no others.

- Every workspace and group act in spec section 11 writes a row, re-confirmation aside (091).

## Negative tests

- Two concurrent last-administrator removals: one is refused and at least one administrator remains.
- A disabled or unclaimed administrator is not counted.
- A Site administrator removing the last Workspace administrator is refused.
- A member of A acting on B's group is refused; a group id from B in a Grant in A is refused.

## Files and areas

`apps/api/src/features/membership/{handler,route,schema,route-policy}.ts`, `apps/api/src/features/agent/actions/membership.ts`, `packages/db/src/queries/grants.ts`, `docs/openapi/admin.json`, `apps/api/e2e/security/`.

## Migration

None.

## Gates

V, D, E, M (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None. The Members screen is 098's.

## Out of scope

Self-grant under second approval (093). Re-confirmation (091). Screens (098).
