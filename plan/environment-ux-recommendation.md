# Independent environment UX recommendation

Status: recommendation for review; no application changes approved or implemented.

## Review input and independence

The independent reviewer received only the
[environment capability brief](../docs/environment-capabilities.md), in a fresh
subagent with no conversation history. They were instructed not to inspect current
UI code, screenshots, other plans or the brief's linked evidence. The reviewer
confirmed that restriction in their response. The recommendation below records
their conclusions, not a new authorization or release policy.

## Recommended model

Use shared authoring with explicit environment operations, organized around each
form. A global environment selector would make editing appear environment-specific
even though drafts are shared. A mandatory deployment pipeline would imply ordering
and verification gates the server does not enforce. An environment-first interface
helps operational oversight but fragments authoring.

- Questions: shared library and version history.
- Forms: shared drafts, preview and immutable published versions.
- Within each form: Authoring, Versions, Environments and Responses.
- Environment overview: releases and intake across forms, linking to operations;
  no duplicate editors.
- Administration: memberships, workspace settings and installation management,
  governed by their separate permissions.

Label authoring as **Shared across environments**. Show environment names
persistently on operational screens. Scope environment selection to those screens
so it does not change the apparent meaning of shared editing.

## Authoring and publication

Keep three concepts distinct:

1. Preview draft: use hypothetical answers against editable content.
2. Publish version: create an immutable snapshot without changing an environment.
3. Release version: change the version new sessions receive in a named environment.

Offer **Publish and release** as a shortcut when both operations are permitted.
Its review must name both effects and the destination. Publication alone remains
available to a user with publishing permission.

Question editing belongs in the shared library, with contextual access from form
authoring. Offer explicit updates when a newer question version exists and show
the affected references and rules. Published forms retain their pinned question
versions. Shared form settings must remain visibly separate from immutable version
content.

Give each published version a stable identity and a review view containing its
questions, rules and comparison with another version.

## Environment operations

For each form, show the configured environments with their current version,
release time, intake state and permitted operations. Keep current state readable
even when the user cannot change it.

A release review should show:

- Form, destination, candidate version and publishing account.
- The current version being replaced and the differences.
- Eligibility evidence, such as a previous test release.
- Intake state and whether new sessions will be accepted.
- The effect on new sessions; existing sessions keep their original version.
- Any missing permission or second-person requirement.

Promotion releases the same version elsewhere. It neither copies a form nor moves
responses. Offer eligible destinations without implying that all environments
must be traversed.

Use **Previously released in test**, not **Verified** or **Passed**. A recorded
test release proves availability, not successful testing.

| Deployment        | Recommended journey                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod only         | Editor publishes; approver releases. A person with both permissions may use the combined shortcut when the second-person rule is off.                 |
| Test/prod         | Publish and release to test, exercise the released version through a secure link, then review and release that same version to prod.                  |
| Dev/test/stg/prod | Use the same destination model for all environments. Dev and staging remain optional under current policy; prior test eligibility still governs prod. |

Use configured names and actual capabilities. Do not derive a mandatory pipeline
from environment display order.

## Roles and approvals

| Role                                          | Recommended experience                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Forms editor                                  | Shared authoring and publication; permitted non-production operations.                                  |
| Forms approver                                | Published-version review and permitted release operations, without requiring entry into a draft editor. |
| Response viewer or eraser                     | Environment- and form-scoped response tools; erasure stays distinct from reading/exporting.             |
| Person with several roles                     | One combined experience, with authorization checked separately for every action.                        |
| Workspace owner or installation administrator | Administrative tools without implied authoring, release or response access.                             |

For readers who cannot perform an operation, show its state read-only and explain
the relevant missing requirement.

For second-person production releases, identify the version's publisher and require
a different eligible releasing account. Do not imply an approval-request or
assignment system already exists. Production webhook proposals must show the active
endpoint separately from the pending change and identify who can confirm it.

## Example journeys

An editor updates shared questions, explicitly updates the form references, previews
the draft and publishes/releases version 12 to test. They exercise a test secure
link and inspect responses or webhook deliveries if separately authorized. An
approver compares version 12 with production's current version, sees the previous
test release, then releases version 12 to production. The result shows the release
record and the intake state, which remains unchanged.

An approver-only user opens eligible published versions, reviews the candidate and
destination state, and releases one. They do not need to edit or republish a draft.

For rollback, an approver selects an older eligible version from production history,
reviews what it replaces and releases it again. Explain that this adds a release
record, affects new sessions, preserves existing sessions, restores no other settings
and does not reopen intake. The publisher-account second-person check still applies.

## Failure and recovery

| Situation                                             | Recommended behavior                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Candidate was never released in test                  | Explain production ineligibility and offer a permitted test-release path.                |
| Publisher attempts a second-person production release | Preserve review context and explain that a different eligible account must release.      |
| Testing reveals a defect                              | Return to the shared draft, publish a new version and repeat verification.               |
| Intake remains closed after release                   | Show Released; intake closed, with a separate permitted reopen action.                   |
| Destination changes during review                     | Refresh destination state and require review of the changed replacement before retrying. |
| Release fails or its outcome is uncertain             | Reconcile current state and release history before offering a retry.                     |
| User cannot inspect responses or deliveries           | Explain the separate permission requirement; do not call the version verified.           |
| Webhook change awaits confirmation                    | Show the active endpoint and pending proposal separately.                                |

Secure links, responses and deliveries always carry explicit environment context.
Link creation must describe the actual version-targeting behavior rather than imply
that every secure link is pinned to a specific version.

## Decisions still required

These recommendations do not change existing policy. The following require an
explicit product decision and potentially backend work:

- Persisted verification results or a required test-pass gate.
- Mandatory dev, test, staging and production sequencing, or stronger staging roles.
- Approval requests, assignment, notifications, expiry or multiple approval stages.
- A concurrency precondition ensuring the destination version reviewed is still
  current when the release commits. Existing release-race detection does not by
  itself establish that precondition.
- Additional historical comparisons or audit evidence beyond current read APIs.

The current application's navigation and workflow remain in effect until a separate
implementation is approved. This recommendation does not amend the existing ADRs.
