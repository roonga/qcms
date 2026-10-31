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

1. `pnpm exec turbo run test --force`, 0 cached, is **done** and needs one more look. The
   first run failed only three `packages/db` integration suites on the known Testcontainers
   `Port … not bound after 210000ms` flake. The rerun cleared all of them, API suite
   included, and failed one unrelated DOM test instead:
   `app/(shell)/form-read-states.test.tsx` > "makes no claim about the pinned versions when
   the library read fails" timed out at its 5000ms cap under the forced run's Docker load.
   It passes in `pnpm verify` and in an admin-only run. That is the issue #604 shape - a
   test whose wall time sits near its timeout - and it belongs to that file rather than to
   this change.
2. The full browser suite, `QCMS_PORT_SEAT=8 QCMS_HARNESS_BUILD=1 pnpm
verify:browser:detached` plus `pnpm verify:browser:wait <dir>` slices. It was started
   on seat 8 and two slices were read before the lane ran out of context; the run had not
   finished, so its error detail had not been written yet. Four specs had failed by then,
   every one of them a spec this branch edits, so expect selector work in the specs rather
   than product defects:

   - `a11y-axe.pw.ts:907` (publish, preview, history and secure links)
   - `agent-launcher.pw.ts:473` (the builder's turns across the form's subtree)
   - `forms-promotion.pw.ts:98` (publish to test, promote the same version to prod)
   - `forms-publish.pw.ts:190` (releases a published version and records it)

   The wizard's own selectors to check first: the source radios are
   `An existing version` / `The shared draft`, the destination checkboxes are labelled with
   the bare environment name inside `[data-testid="qcms-publish-destinations"]`, the step
   buttons are `Continue` / `Back` / `Confirm`, and `Cancel` on the source step is a link
   rather than a button. `agent-launcher.pw.ts:473` walks the form subtree and was swapped
   from `/releases` to `/publish`; its context chip key is now
   `agent.context.form.publish`.

   `auth-2fa.pw.ts:105` fails on a production build until PR #1196 merges.

## One decision for the Code Owner

"One publish entry" is met on the Versions screen and the rail: the wizard is the only
entry that releases anything, and the release dialog is gone. The **builder** still has
its own Publish and Publish-to-{env} buttons (`components/forms/form-actions.tsx`, reached
from `/forms/{formId}` and from `form-production-review.tsx`), so an author who never
visits Versions still has a second way to publish. Retiring those two buttons in favour of
a link into the wizard is the honest reading of the exit criterion; it also deletes
`publishFormAction` and `publishAndReleaseAction` and rewrites six test files, which is
why it was not folded into this change.
