# 090 - Account creation and claim

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `@roonga/qcms-db`, `apps/admin` (claim path through the forced screens) · **Depends on:** 087, 088, 089
**References:** `docs/WORKSPACE_ACCESS.md` section 7 (creation, directory visibility) · `docs/features/061-forced-password-change.md` · `plan/workspace-access-implementation.md` (090) · `plan/work-order-sequence.md`

## Context

A Site administrator creates an account by address; the server emails a single-use link; nobody else sees it. The claim reuses the forced password and second-factor screens.

## Deliverables

- Site administrator routes: list and search accounts (paged; role and status filters), create, resend (invalidates the prior link).
- `control.sign_in_links`: hash only, expiry at 72 hours, used flag, delivery status.
- Create is refused while mail is not configured; the first account (`qcms:create-admin`) is exempt.
- Claim forces password set and second-factor enrolment before any other act, reusing the forced screens.
- Grants while unclaimed are audited.
- The generic add-member answer from 084 extended to disabled and unclaimed accounts.
- Create, resend and claim audited in the site audit.

## Exit criteria

Spec criteria owned: **50, 51, 52, 53, 54, 55, 56, 57**. This task owns those and no others.

- Criterion 54's approver clause is also exercised by 093's criterion 40; this task proves the "cannot act" and "not counted" clauses.
- An account is usable only after claim with a second factor.

## Negative tests

- Link reuse, expiry after 72 hours and use by the wrong account are refused.
- Only the link hash is at rest.
- Create is refused with no mail configured.
- A Workspace administrator cannot browse accounts.
- The add-member answer is identical for unknown, disabled and unclaimed addresses.

## Files and areas

New `apps/api/src/features/accounts/`, `apps/api/src/features/auth/`, `apps/api/src/features/membership/route-policy.ts`, `packages/db/src/schema/control/`, `packages/db/migrations/`, `apps/admin/lib/server/`, the forced screens in `apps/admin`, `docs/openapi/admin.json`, `apps/api/e2e/security/`.

## Migration

Yes. Fifth in the migration queue (planned `0012`; numbered at rebase time).

## Gates

V, D, B, E, M (`plan/work-order-sequence.md`, Gates). B because the claim path changes `apps/admin`.

## Review

Fable first round; Sonnet delta.

## Design gate

None. Reuses the forced screens; the Accounts screens are 100's.

## Out of scope

Disable, reactivation and reset (091). The Accounts screens (100). The 1,000-account timing fixture (105).
