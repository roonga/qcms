# 094 - The single Publish step

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/api`, `apps/admin` · **Depends on:** 085; design batch 6 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` section 5 · `docs/form-publishing-flow.md` · `plan/workspace-access-implementation.md` (094) · `plan/work-order-sequence.md`

## Context

One user-facing step, "Publish to `<environment>`", over frozen versions. The API already has `publish-batch` and `release-batch`; the work is the fixed `prod` floor, the screens, the assistant publish cards and the forms-area copy. The builder's open-wizard tool (112) and `returnTo` (113) build on this wizard.

## Deliverables

- Draft publish freezes and makes live in one act (`publish-batch`); an existing version to another environment (`release-batch`).
- `releases/workflow.ts` generalised from "prior test" to "prior non-prod" as a fixed floor no workflow configuration can lift, applied only where the site has a non-prod environment. A prod-only site publishes a draft to `prod`.
- Publish tab, publish wizard, release panel and tables, version history, production review.
- **Agent kinds:** the assistant publish cards (`agent/actions/releases.ts`, `components/agent/step-actions.ts`) on the new cells; a draft publish needs Edit forms and Publish forms.
- Forms-area copy: no "Release" in the forms UI. API paths and identifiers keep their names.

## Interim behaviour until later tasks land

- **Prod-only site draft publish with second approval on (until 093):** refused outright. 093 makes it a held request.

## Exit criteria

Spec criteria owned: **5, 7, 8, 18**. This task owns those and no others.

- No "Release" in the forms UI; `prod` accepts only a version live in a non-prod environment, where one exists.

## Negative tests

- A draft straight to `prod` is refused under every workflow configuration where a non-prod environment exists.
- On a prod-only site a draft publishes to `prod` with the rule off.
- A Publish-only holder cannot freeze a draft.
- An Edit-only holder sees Publish disabled with a reason.

## Files and areas

`apps/api/src/features/{releases,forms}/`, `apps/api/src/features/agent/actions/releases.ts`, `apps/admin/components/forms/`, `apps/admin/components/agent/step-actions.ts`, `apps/admin/app/(shell)/forms/[formId]/{publish,versions}/`, `apps/admin/lib/server/releases.ts`, `apps/admin/lib/i18n/en.ts`, `docs/openapi/admin.json`.

## Migration

None.

## Gates

V, D, B, E (`plan/work-order-sequence.md`, Gates). E because the floor changes cross-service release behaviour.

## Review

Fable first round; Sonnet delta.

## Design gate

Yes: batch 6 (single Publish step) on the canvas and seen by the Code Owner before dispatch.

## Out of scope

Second approval on publish (093). Builder entry to the wizard (112, 113). Question "Publish" keeps its meaning.
