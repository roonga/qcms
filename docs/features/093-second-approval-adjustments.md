# 093 - Second approval adjustments

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api` · **Depends on:** 085, 089, 092
**References:** `docs/WORKSPACE_ACCESS.md` section 6 · `docs/features/070-two-person-rule.md` (as built) · `plan/workspace-access-implementation.md` (093) · `plan/work-order-sequence.md`

## Context

Brings the built two-person rule in line with spec section 6 and adds the held workspace requests on 092's table.

## Deliverables

- `prod` only. The publish approver is another Publish forms holder for `prod` in that workspace; the webhook proposal confirmer follows the same rule.
- **Prod-only site draft publish** with the rule on becomes an approval request (092 table, 7-day expiry), approved on the form by another Publish forms holder for `prod`; the freeze and the publish are applied together on approval. The requester is recorded as the freezer and the approver as the approver.
- **Draft changed since requested:** the request binds the draft's single revision counter and a content hash over the whole draft row, questions and appearance alike, so any later draft save, an appearance-only one included, refuses the approval with the spec's message. Once 108 adds `appearance`, it is in the hash with no change here; 121 proves the appearance clause (criterion 117).
- **Switch-off and self-grant** while the rule is on become workspace approval requests, decided by a different Workspace administrator or a Site administrator who is not the requester, listed for the workspace Requests row and for Site configuration Approval requests. Self-grant covers any Grant or group edit that gives the actor a response role or a new environment for one, including editing a group the actor is in. A pending request binds the group's roles and environments at request time. This replaces 085's interim refusal and interim switch-off.
- Every held request (self-grant, switch-off, prod-only draft publish; 095 adds Move form) is re-checked at approval against what the requester still holds, and refused otherwise.
- Turning the rule on is refused where nobody else could approve; a Site administrator who is not the requester counts as the second administrator.
- The settings read returns whether nobody else could approve, for the Settings warning.
- Audit rows for every request state.

## Exit criteria

Spec criteria owned: **27 to 44, 46, 47, 49, 116**. This task owns those and no others.

- Criterion 48 (re-check at approval) is owned by 095, which lands when every held kind exists; this task's negative tests cover its own kinds.

## Negative tests

- Self-approval of a publish, an endpoint change, a switch-off and a self-grant is refused, a Site administrator requester included.
- A sole administrator with no Site administrator cannot turn the rule on.
- **Unclaimed or disabled approvers:** an unclaimed or disabled account cannot approve a `prod` publish, a `prod` endpoint change or a workspace request, and is not counted as the second administrator or the second Publish forms holder.
- A non-prod publish by the freezer is not gated; links and open or close are not gated.
- A member adding View responses or `prod` to their own group is held; the same edit by a non-member applies.
- Joining a role-less group and then adding a response role is held.
- Approval never grants a role or environment added after the request.
- The warning flag is set once the only other approver is disabled.
- Prod-only draft publish: nothing frozen until approved; the requester's or a non-holder's approval refused; the requester's later `prod` publish of that version refused.
- Approval refused when the requester lost Edit forms or Publish forms for `prod`, or the administrator role, after the request.
- Approval refused after a question change to the draft.

## Files and areas

`apps/api/src/features/membership/{two-person,handler}.ts`, `apps/api/src/features/webhooks/`, `apps/api/src/features/workspaces/`, `apps/api/src/features/releases/`, `docs/openapi/admin.json`.

## Migration

None. Uses 092's table.

## Gates

V, D, E (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None. The pending and approve states on screens are 099 and 103.

## Out of scope

Move form (095). Screens (099, 101, 103).
