# Form publishing workflow: test to production

Status: implemented. Updated 2026-10-26.

This amends the form-authoring UX in [the environments plan](environments-and-workspaces.md)
for deployments serving both `test` and `prod`. It keeps one shared draft and one
immutable version history. Prod-only deployments are outside this change.

## Agreed workflow

1. Select **test** in the top navigation.
2. Create or edit the shared form draft and preview it.
3. Choose **Publish to test**. One transaction creates a version and releases it to test.
4. Open a test secure link and verify the respondent journey and submission.
5. Select **prod** in the top navigation.
6. Select the existing version verified in test and choose **Release vN to prod**.

A failed test returns to draft editing and another publication to test. Promotion
uses the chosen immutable version, even if a newer draft or published version exists.

## Screens and actions

| Selected environment | Surface                                      | Available action                             |
| -------------------- | -------------------------------------------- | -------------------------------------------- |
| test                 | Draft builder and preview                    | Publish to test                              |
| test                 | Existing version history                     | Release an existing version to test          |
| prod                 | Published version review and release history | Release an eligible existing version to prod |
| prod                 | Notice that a shared draft exists            | Switch to test to edit the draft             |

- The top switch is the destination for environment-specific actions. Remove the
  target-environment selector from release dialogs. Test exposes no prod release action.
- Replace the separate form **Publish** and **Publish and release** choices with
  **Publish to test** in this workflow. Neither draft publishing nor draft editing is
  offered in the prod view; review there renders a stored published version.
- A publish confirmation names both effects: "Create v4 and release it to test."
  Success names the version and environment and offers access to test links.
- A production confirmation identifies the exact candidate and the version it replaces.
  Use the version currently released to test as the initial candidate, and allow other
  eligible versions to be selected. Require an explicit confirmation.
- Show current release state prominently: "Test: v4" and "Prod: v3". History may show
  both environments; actions always target the selected one.
- Availability follows effective permissions. Explain disabled actions using the
  missing permission or approval requirement, including when the publisher cannot
  release their own version. Do not rely on a failed request to teach the restriction.
- Publishing into closed intake preserves the closed state and says so in the result.

## Production eligibility and approval

- A promotion candidate must already have a release record in test. Eligibility uses
  release history, rather than only the version currently released to test, so testing
  a later version does not invalidate an earlier candidate.
- "Released to test" is a recorded fact; successful manual testing is the operator's
  responsibility. This change adds no QA sign-off state and must not label a version
  "tests passed" merely because it was released there.
- A version previously released to prod also remains available for rollback, including
  versions deployed before this workflow. Rollback appends a release record.
- Prod requires `forms.approver` with prod in scope in the form's workspace.
  With the second-person rule enabled, the releaser must differ from the publisher.
  Publication in test records that publisher, so this existing rule continues to work.
- No draft is published during promotion and no new version is created. Production
  review and confirmation refer to the candidate's stored content, not the draft.

## Implementation

1. Record this UX amendment in the environments plan and ADR-40. Retain distinct
   publication and release records; combine the ordinary test-authoring action.
2. Reuse `POST /forms/{id}/publish-and-release` for **Publish to test**. Preserve its
   atomic validation, version creation, draft deletion, release and outbox transaction.
   A refused action leaves the draft and existing release untouched.
3. Bind ordinary release actions to the environment shown by the server-rendered page.
   Reuse `confirmShownEnvironment`, as the combined action already does. Remove the
   client-controlled target from the UI action input; reject stale-tab confirmations
   and require the operator to review the refreshed environment before retrying.
4. Derive UI action availability from the existing effective permission model and
   second-person rule. Keep API authorization authoritative for every release target.
5. Enforce the production eligibility rule in the API as well as the version picker.
   For the test/prod workflow, reject direct draft publish-and-release into prod and
   reject new prod releases with neither prior test nor prod release history. Preserve
   permission and second-person checks. Keep the library-only publish API's meaning.
6. Render the prod form view as published-version review, with a path to switch to
   test for authoring. Preserve shared drafts, pinned question versions, existing
   session pins, environment-scoped links, responses and intake state.
7. Update copy, scaffold templates, API documentation, the flow diagram and E2E tests.

The production eligibility rule intentionally changes the current allowance for a
first release directly to prod in a test/prod deployment. Amend the corresponding
ADR-40 ruling and integration tests explicitly. It needs no new database tables:
existing release history supplies the evidence. Question publication remains a
shared-library operation and does not release a form to an environment.

## Acceptance checks

- Publishing a valid draft in test creates and releases vN in one action; prod is
  unchanged. Validation or release failure persists neither a new version nor a release.
- While test is selected, no target selector or prod release action is available,
  including to a user who holds prod permissions. A stale tab cannot release after
  another tab changes the environment.
- Switching to prod offers eligible published versions, renders the exact selected
  snapshot, and releases the chosen version without republishing. A newer draft or
  test release cannot silently change the selected candidate.
- API requests cannot bypass prod permission, production eligibility or the optional
  second-person rule. Cover a test-only user, the publisher and a second approver.
- Previously deployed prod versions remain usable for rollback. New sessions receive
  the new release; existing sessions keep their original version. Closed intake stays closed.
- Extend the existing Playwright promotion journey to the combined test action and
  locked target, including negative UI assertions and the second-approver scenario.
- Exercise the journey against Docker with both environments enabled: test secure
  links keep the public origin and `/test/` prefix and submissions stay in test.
- Run the relevant component, server-action, API and Playwright checks; verify template
  consistency and CI discovery of the updated journey.
