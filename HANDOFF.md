HANDOFF: INTERRUPTED

Phase 5 of the environment-navigation plan (issue #1197) is implemented and `pnpm verify`
is green at this commit. Two gates are outstanding and nothing in the diff is known to be
wrong; the lane ran out of working context before it could sit through them.

## What is done

- The merged Versions view at `/forms/{formId}/versions`, the publish wizard at
  `/forms/{formId}/publish`, and `/forms/{formId}/releases` as a redirect to Versions.
- The three server actions the wizard drives (`reviewReleaseAction`,
  `confirmPublishAction`, `lookupPublishResultAction`) over the phase 3 routes.
- The six registration places, the scaffolding templates and the changeset.
- `apps/admin` unit and DOM suites green; `pnpm verify` green.
- The browser specs that used to open the release dialog now drive the wizard through
  `apps/admin/e2e/support/publish.ts`, and the axe sweep walks each of its three steps.

## What is left, in order

1. `pnpm exec turbo run test --force`, 0 cached. The first run failed only on three
   `packages/db` integration suites with the known Testcontainers `Port … not bound after
   210000ms` flake, in suites this branch does not touch. A rerun was started and its
   outcome was not read. Confirm the API suite too: that run's tail was truncated, so
   `publish-batch.integration.test.ts` (which this branch adds a case to) has not been
   seen green.
2. The full browser suite, `QCMS_PORT_SEAT=8 QCMS_HARNESS_BUILD=1 pnpm
   verify:browser:detached` plus `pnpm verify:browser:wait <dir>` slices. It has **not
   run at all** on this branch, and five specs changed:
   `forms-publish.pw.ts`, `forms-promotion.pw.ts`, `two-person-rule.pw.ts`,
   `a11y-axe.pw.ts` and `rail.pw.ts`, plus the new `support/publish.ts`. Expect selector
   work there rather than product defects. `auth-2fa.pw.ts:105` fails on a production
   build until PR #1196 merges.

## One decision for the Code Owner

"One publish entry" is met on the Versions screen and the rail: the wizard is the only
entry that releases anything, and the release dialog is gone. The **builder** still has
its own Publish and Publish-to-{env} buttons (`components/forms/form-actions.tsx`, reached
from `/forms/{formId}` and from `form-production-review.tsx`), so an author who never
visits Versions still has a second way to publish. Retiring those two buttons in favour of
a link into the wizard is the honest reading of the exit criterion; it also deletes
`publishFormAction` and `publishAndReleaseAction` and rewrites six test files, which is
why it was not folded into this change.
