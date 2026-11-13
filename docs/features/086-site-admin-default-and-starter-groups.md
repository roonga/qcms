# 086 - Site administrator default and starter groups

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `@roonga/qcms-db`, `create-qcms-app` templates · **Depends on:** 085
**References:** `docs/WORKSPACE_ACCESS.md` sections 4, 8 and 9 · `plan/workspace-access-implementation.md` (086) · `plan/work-order-sequence.md`

## Context

Today every account defaults to the installation claim (`role` in `apps/api/src/features/auth/instance.ts`). This task makes Site administrator explicit and gives every new workspace its four starter groups.

Green field: no data migration (spec section 1).

## Deliverables

- `user.role` stops defaulting to Site administrator. The first account, created by `qcms:create-admin`, is one.
- `POST /admin/workspaces` is Site administrator only, takes the first Workspace administrator by address (default the caller), and creates the workspace and the four starter groups in one transaction, audited.
- Starter groups per spec section 4: Authors covers every non-prod environment the site has, or carries Edit forms only with no environment on a site whose only environment is `prod`; Publishers, Response viewers and Response erasers cover `prod`.
- First-run bootstrap: the first account is Site administrator, Workspace administrator of the first workspace and a member of all four starter groups; second approval off. This replaces the `all.*` seed.
- **Agent kinds:** the workspace-create kind takes the first administrator and runs on the new rule.
- Fixtures and template mirrors.

## Interim behaviour until later tasks land

- **Claimed first administrator (until 088):** the named account must exist. 088 adds `claimedAt` and refuses an unclaimed one (criterion 93). No unclaimed account can exist before 090.

## Exit criteria

Spec criteria owned: **20, 75, 92, 94, 95, 110**. This task owns those and no others.

## Negative tests

- A new account holds nothing and is not a Site administrator.
- Workspace creation by a non-Site administrator is refused.
- The first administrator must be an existing account.
- With `dev`, `test` and `prod`, Authors covers `dev` and `test`.
- On a site whose only environment is `prod`, Authors carries Edit forms only with no environment, and no starter group carries Publish forms, View responses or Erase responses with an empty set.

## Files and areas

`apps/api/src/features/auth/{instance,bootstrap}.ts`, `create-admin.ts`, `apps/api/src/features/workspaces/{handler,schema}.ts`, `apps/api/src/features/agent/actions/`, `packages/db/src/schema/control/auth.ts`, `packages/db/migrations/`, fixtures, `packages/create-qcms-app/templates/`, `docs/openapi/admin.json`.

## Migration

Yes. Second in the migration queue (planned `0009`; numbered at rebase time).

## Gates

V, D, E (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None. The New workspace screen is 101's.

## Out of scope

Account state and the site audit (088). Site administrator promotion and demotion (092). The New workspace screen (101).
