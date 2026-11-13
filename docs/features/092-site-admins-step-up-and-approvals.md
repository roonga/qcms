# 092 - Site administrators, step-up and approval requests

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `@roonga/qcms-db` · **Depends on:** 088, 091
**References:** `docs/WORKSPACE_ACCESS.md` sections 6 (workspace approval requests) and 8 · `apps/api/src/features/webhooks/` endpoint proposals (the two-act pattern) · `plan/workspace-access-implementation.md` (092) · `plan/work-order-sequence.md`

## Context

The approval-request table both scopes use, step-up authentication, and the Site administrator acts. 093 and 095 build their held requests on this table.

## Deliverables

- `control.approval_requests`: scope (site or workspace), kind, target, requester, decider, status, `expires_at` at 7 days; the decider is never the requester. Modelled on `packages/db/src/schema/control/endpoint-proposals.ts` and `packages/db/src/queries/endpoint-proposals.ts`.
  - A `payload` jsonb column holding what a request binds at request time, validated per kind: the group's roles and environments for a self-grant (093), the draft revision and content hash for a prod-only draft publish (093), the destination workspace for Move form (095). This is the last access migration, so every column 093 and 095 need is added here.
- Request, approve, reject and expire; expiry swept on the existing interval.
- Step-up: password and second factor, bound to the session, valid 5 minutes.
- Promote and demote a Site administrator, and disable an account that is one (replacing 091's interim refusal), with the guards and defaults of spec section 8.
- Only active, claimed Site administrators count or approve; an unclaimed account cannot be promoted; the target of a demotion or disable never approves; with exactly two, step-up alone suffices and is audited.
- Every state change in the site audit.
- No agent kind for any act here (plan default: step-up cannot run in a card).

## Exit criteria

Spec criteria owned: **22, 76, 77, 78, 79, 80, 81, 82, 83, 84**. This task owns those and no others.

- Criterion 22 enumerates every site route that exists when this task lands; 105's matrix re-proves it at the end.

## Negative tests

- Promote without step-up is refused; step-up from another session is refused.
- The requester approving their own request is refused.
- A request whose `payload` fails its kind's schema is refused on write.
- A request is refused after 7 days.
- Demoting or disabling the last active Site administrator is refused.
- Disabling a Site administrator without a second approval, where two or more others exist, is refused.
- A non-Site administrator is refused on every route.
- **Unclaimed or disabled approvers:** an unclaimed or a disabled Site administrator cannot approve and is not counted as a second Site administrator; promoting an unclaimed account is refused.
- The target approving its own demotion or disable is refused.
- With exactly two, step-up alone demotes or disables the other and the row records it.

## Files and areas

`packages/db/src/schema/control/`, `packages/db/migrations/`, `apps/api/src/features/accounts/` or new `site-admins/`, `apps/api/src/features/auth/`, `apps/api/src/features/membership/route-policy.ts`, `docs/openapi/admin.json`, `apps/api/e2e/security/`.

## Migration

Yes. Sixth and last access migration in the queue (planned `0013`; numbered at rebase time).

## Gates

V, D, E, M (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None. Screens are 100 and 101.

## Out of scope

Workspace-scope request kinds (093, 095). Screens (100, 101).
