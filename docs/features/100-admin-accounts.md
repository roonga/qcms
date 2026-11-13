# 100 - Admin Accounts

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 090, 091, 092, 097; design batch 4 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` sections 7, 8 and 12 · `plan/work-order-sequence.md`

## Context

The first Site configuration screens. This task adds the Site configuration mode and its rail; 095 and 101 add their rows to it.

## Deliverables

- Site configuration Accounts: list, search, filters.
- Create: email sent state, resend, refusal while mail is not configured.
- Account page with holdings across workspaces.
- Disable with the workspace list (step-up and approval for a Site administrator); reactivate; reset. No delete.

## Exit criteria

No spec criterion is owned here; the account criteria are owned by 090, 091 and 092.

- New `accounts.pw.ts` green.

## Negative tests

- A Workspace administrator never sees the area.
- The last Site administrator's disable control is disabled with the reason, and the route still refuses it.

## Files and areas

New `apps/admin/app/(shell)/site/accounts/`, `apps/admin/lib/shell/modes.ts`, `apps/admin/components/admin-nav.tsx`, `apps/admin/lib/server/`, `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/accounts.pw.ts`.

## Migration

None.

## Gates

V, B, E (`plan/work-order-sequence.md`, Gates). E because the email sent state is proven against Mailpit.

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: batch 4 (Site configuration).

## Out of scope

Site administrators, Approval requests, Site audit, Workspaces (101).
