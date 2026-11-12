# 088 - Account state and the site audit

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `@roonga/qcms-db` · **Depends on:** 086; merges after 108 in the migration queue
**References:** `docs/WORKSPACE_ACCESS.md` sections 7 (sessions), 9, 10 and 11 · SEC-15 · `plan/workspace-access-implementation.md` (088) · `plan/work-order-sequence.md`

## Context

Adds the account and membership state every later account task reads, and the second append-only log. The per-request checks land here; the acts that set the state (create, disable, reset) land in 090 and 091.

Green field: no data migration (spec section 1).

## Deliverables

- `user.disabledAt`, `user.claimedAt`; `team_member.suspendedAt` and `suspendedBy` (who performed the reset or reactivation).
- Workspace creation refuses an unclaimed first Workspace administrator (closes 086's interim).
- The session verifier reads the disabled flag on every request; no cache.
- The resolver ignores disabled, unclaimed and suspended memberships.
- A streamed export aborts, and an agent Confirm is refused, once the account is disabled.
- `control.site_audit`, with the application role holding `INSERT` and `SELECT` only; a writer, and a mirror helper into `access_audit`.
- Settle and record the new audit kinds, the site audit's row shape, and whether a refusal for a changed draft gets a kind (handover nit), in the PR and in spec section 16.
- The site audit read route, Site administrator only.
- **Agent kinds:** Confirm reads the disabled flag (criterion 91's account half is proven by 096).

## Exit criteria

Spec criteria owned: **66, 67, 93, 112, 113**. This task owns those and no others.

- Criterion 66 is proven by setting `disabledAt` directly; 091 adds the Disable act and its same-transaction session delete.

## Negative tests

- A stale session is refused after disable (real Postgres).
- An unclaimed first Workspace administrator is refused at workspace creation.
- The export stream stops; the Confirm is refused.
- A suspended membership grants nothing.
- The application role cannot update or delete a `site_audit` row.
- A non-Site administrator cannot read the site audit.

## Files and areas

`packages/db/src/schema/control/{auth,access-audit}.ts`, new `packages/db/src/schema/control/site-audit.ts`, `packages/db/src/queries/`, `packages/db/migrations/`, `apps/api/src/middleware/admin-auth.ts`, `apps/api/src/features/membership/resolver.ts`, `apps/api/src/features/responses/admin/` (export), `apps/api/src/features/agent/`, fixtures, `docs/openapi/admin.json`.

## Migration

Yes. Fourth in the migration queue, after 085, 086 and 108 (planned `0011`; numbered at rebase time).

## Gates

V, D, E (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None.

## Out of scope

The acts that disable, reset or reactivate (091). Account creation and claim (090). Site audit screen (101).
