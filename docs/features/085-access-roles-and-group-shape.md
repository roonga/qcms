# 085 - Access roles and the group shape

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `@roonga/qcms-db`, `apps/admin` (removals only), `create-qcms-app` templates · **Depends on:** the workspace access spec on `main`
**References:** `docs/WORKSPACE_ACCESS.md` sections 2, 3, 9 and 16 · SEC-3 §3.2 in `docs/SECURITY_DESIGN.md` · ADR-41 · `plan/workspace-access-implementation.md` (085) · `plan/work-order-sequence.md`

## Context

The foundation task. It replaces the six roles, form scope and `all` with five roles and one explicit environment set per access group (spec section 3). It touches `policy.ts`, `route-policy.ts` and every fixture, so it **runs alone on `policy.ts`**: no other PR on `policy.ts` or `route-policy.ts` is open while it is.

Green field: the removal of form scope, old roles and the seed setting is not data loss; there is no migration path (spec section 1).

## Deliverables

- The five roles and the role-by-act matrix of spec section 3 in `policy.ts` and `route-policy.ts`. Workspace administrator stays the member-row flag.
- Remove `forms.approver`, the `prod` split in `policy.ts`, `all`, `FORM_SCOPED` and `team.forms`.
- A group holds several roles and one environment set. The set is ignored for View forms and Edit forms and required non-empty otherwise; no implicit environment.
- Settle and record the group storage shape and the fate of the `<environments>.<role>[.<label>]` name grammar (spec section 16), in the PR and in the spec's section 16.
- Remove `seedNewEditorsWithTestData`: column, route field, UI and handler.
- Admin screens: removal only. The seed switch, the form-scope picker and the `all` environment option go. The existing group form keeps saving one role with an explicit environment set until 098.
- `two-person.ts` messages and the role it checks, on the new roles.
- Remove the question-move route `POST /admin/questions/{id}/workspace`: handler, route-policy row, OpenAPI.
- Bootstrap, `seedGrants`, e2e support and template mirrors on the new shape.
- Update the SEC-3 §3.2 role table with the policy code, since `matrix-coverage.e2e.ts` reads it.
- **Agent kinds:** `grant-filter.ts` drops form-id widening, and every agent action kind on a route this task changes is offered and executed on the new matrix. 096 audits parity across all kinds afterwards.

## Interim behaviour until later tasks land

- **Move form (until 095):** `POST /admin/forms/{id}/workspace` needs Edit forms in both workspaces and a Workspace administrator of the source, and is refused outright while second approval is on in the source. No move is held; 095 adds the held request.
- **Self-grant (until 093):** with second approval on, a self-grant of a response role is refused outright, as built today, on the new roles. With it off, it applies and is audited.
- **Turning second approval off (until 093):** applies at once for a Workspace administrator or the installation claim holder and writes its `setting` row, as built. 093 makes it a held request.

## Exit criteria

Spec criteria owned: **2, 3, 4, 6, 9, 10, 11, 12, 13, 14, 17, 19, 24, 107, 108**. This task owns those and no others.

- No `forms.approver`, `all`, form scope or seed setting remains in code, schema, fixtures or templates.
- The Access groups screen still creates and lists groups.
- Every route row is decided by the new matrix.

## Negative tests

- An unknown role fails closed.
- A View forms or Edit forms holder is denied publish, links and webhooks.
- A Publish forms holder without Edit forms cannot publish a draft; an Edit forms holder in `test` cannot publish to `prod`.
- An administrator with no group is denied read, export and erase.
- A holder in A is denied every act in B.
- An environment added later is covered by no group.
- A group can no longer name forms; a group carrying Publish forms, View responses or Erase responses with no environment is refused on save.
- The question-move route no longer exists.
- The interim move and self-grant refusals above.

## Files and areas

`apps/api/src/features/membership/{policy,route-policy,handler,schema,resolver,two-person}.ts`, `apps/api/src/features/agent/grant-filter.ts` and `actions/`, `packages/db/src/schema/control/auth.ts`, `packages/db/src/access-groups.ts`, `packages/db/migrations/`, `apps/api/src/features/auth/{instance,bootstrap}.ts`, `apps/*/e2e/support/`, `apps/admin/lib/i18n/en.ts`, `packages/create-qcms-app/templates/`, `docs/SECURITY_DESIGN.md`, `docs/openapi/admin.json`.

## Migration

Yes. First in the migration queue (planned `0008`; numbered at rebase time).

## Gates

V, D, B, E, M (`plan/work-order-sequence.md`, Gates).

## Review

Fable first round; Sonnet delta.

## Design gate

None. Admin changes are removals only.

## Out of scope

Several roles per group in the admin form (098). Starter groups and the Site administrator default (086). Account state (088). The single Publish step (094).
