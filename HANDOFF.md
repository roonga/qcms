HANDOFF: AWAITING-HUMAN Code Owner review of design batch 6 (Form-Publish, Held-Publish and Phone-F boards on the workspace access canvas) before the admin half of 094

# 094 handoff

The work order's design gate requires batch 6 on the canvas and seen by the Code Owner before dispatch. The boards are on the canvas, and `docs/WORKSPACE_ACCESS.md` section 12 still says the canvas has not been reviewed by the Code Owner. No record of that review exists, so only the API half is built.

## Done on this branch

- `releases/workflow.ts`: the fixed `prod` floor (`withProductionFloor`), applied to the default and every stored revision where a non-prod environment is served. A prod-only site publishes a draft to `prod`.
- The workflow write judges acyclicity with the floor in place.
- Prod-only site, second approval on: a draft publish to `prod` is refused outright (`APPROVER_IS_AUTHOR`) until 093.
- Agent kind descriptions for `form.publish` and `form.release` in the new vocabulary; cells unchanged (085 already requires Edit forms and Publish forms for a draft publish).
- Tests for criteria 5, 7, 8 and 18 and the API negative tests; docs, template mirrors and OpenAPI.

## Blocked on the review

- Publish tab, publish wizard, release panel and tables, version history, production review (`apps/admin/components/forms/`, `app/(shell)/forms/[formId]/{publish,versions}/`, `lib/server/releases.ts`).
- Assistant card copy (`components/agent/step-actions.ts`, `en.ts`) and forms-area copy: no "Release" in the forms UI.
- Negative test: an Edit-only holder sees Publish disabled with a reason.
- Gate B for the admin half.

## To resume

Once the Code Owner has seen batch 6, remove this file, build the admin half against the Form-Publish board, and rerun V, D, B and E.
