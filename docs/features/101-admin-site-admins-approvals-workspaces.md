# 101 - Admin Site administrators, Approval requests and Workspaces

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 086, 092, 099, 100; design batch 4 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` sections 6, 8, 9 and 12 · `plan/work-order-sequence.md`

## Context

The rest of Site configuration. It depends on 099 so that one end-to-end test can show a workspace request in both of its homes.

## Deliverables

- Site administrators: promote and demote with a step-up dialog.
- Approval requests, site and workspace: pending, approved, rejected, expired.
- Site audit.
- Workspaces list and New workspace (first administrator, starter groups checklist).

## Exit criteria

Spec criteria owned: **45**. This task owns that and no other.

- Flows match the batch 4 artboards.

## Negative tests

- A failed step-up keeps the request unsent.
- A requester sees no Approve button on their own request, and the route still refuses it.

## Files and areas

`apps/admin/app/(shell)/site/`, `apps/admin/app/(shell)/workspaces/{all,new}/`, `apps/admin/lib/shell/modes.ts`, `apps/admin/components/admin-nav.tsx`, `apps/admin/lib/i18n/en.ts`.

## Migration

None.

## Gates

V, B, E (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: batch 4 (Site configuration).

## Out of scope

Accounts (100). Shared question library screen (095).
