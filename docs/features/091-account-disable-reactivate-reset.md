# 091 - Account disable, reactivation and reset

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `@roonga/qcms-db` · **Depends on:** 089, 090
**References:** `docs/WORKSPACE_ACCESS.md` section 7 (reset, disable, reactivation) and section 11 · `plan/workspace-access-implementation.md` (091) · `plan/work-order-sequence.md`

## Context

The acts that end or restore an account's access, and the re-confirmation of suspended response memberships.

## Deliverables

- **Disable:** sessions deleted in the same transaction; the last active, claimed Site administrator refused; response holdings and last-Workspace-administrator workspaces returned for the confirmation; disable removes the Site administrator role; no delete route.
- **Reactivate:** through an emailed link; response-role memberships suspended, others restored at once.
- **Credential and factor reset:** sessions revoked; response-role memberships suspended; sign-in again through an emailed link; a factor-only reset does not force a new password.
- **Re-confirm** a suspended membership: a Workspace administrator of that workspace or a Site administrator. Refused for the person in `suspendedBy` where an active, claimed administrator other than that person and the subject exists; where none exists, that person may re-confirm and the audit row records it. Always refused for the subject.
- The Workspace administrator flag is never suspended.
- One site-audit row per act, mirrored to every affected workspace.

## Interim behaviour until later tasks land

- **Disabling a Site administrator (until 092):** refused outright. 092 replaces this with the step-up and approval guards.

## Exit criteria

Spec criteria owned: **58, 59, 60, 61, 62, 63, 64, 65, 68, 69, 70, 71, 72, 73, 74**. This task owns those and no others.

## Negative tests

- Disabling the last Site administrator is refused; disabling any Site administrator is refused until 092.
- The resetter or reactivator re-confirming is refused where another active, claimed administrator exists, a Site administrator included; with none, or only a disabled or unclaimed one, the re-confirmation applies and the row records it.
- The subject re-confirming their own membership is refused, on a sole-administrator site too.
- The Workspace administrator flag survives a reset and a reactivation.
- A reactivated former Site administrator is not one.
- A Workspace administrator cannot disable.
- A reactivated account reads no responses until re-confirmed.
- A reset revokes live sessions.
- No route deletes an account.
- Every act writes site and mirrored rows.

## Files and areas

`apps/api/src/features/accounts/`, `apps/api/src/features/auth/reset-two-factor.ts`, `apps/api/src/features/membership/resolver.ts`, `packages/db/src/queries/`, `docs/openapi/admin.json`.

## Migration

None.

## Gates

V, D, E (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None. The account page is 100's.

## Out of scope

Step-up and Site administrator approvals (092). Account screens (100).
