# Environment capabilities: UX review brief

For the latest agreed navigation/publishing direction and a code-backed role audit,
see the [implementation handover](../plan/environment-navigation-implementation.md).
This earlier capability brief and the interactive POC do not override the existing
permission matrix. The POC is flow guidance, not a visual specification.

This brief describes domain capabilities and constraints for an independent UX
recommendation. It deliberately specifies no navigation, screen layout, control
placement or interaction sequence. It records current server capabilities; it does
not approve a new workflow or change authorization.

## Shared content and environment state

| Shared across the deployment                                      | Separate for each environment                  |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| Workspaces, memberships and access grants                         | The form version currently released            |
| Question identities and version history                           | Whether a form accepts new sessions            |
| Form identities, editable drafts and immutable published versions | Respondent sessions, answers and submissions   |
| A form version's exact question-version references and rules      | Secure-link destination and access             |
| Form-level challenge and minimum-submit-time settings             | Webhook endpoints, delivery history and outbox |

- Editing a question or form draft changes shared authoring content. There is no
  independent dev, test, staging or production copy of that draft.
- Question versions used by a published form are pinned. A question edit does not
  rewrite an existing published form; an author must update its references and
  publish a new form version to include the change.
- Publishing creates an immutable version. Releasing makes an existing published
  version available in an environment. The combined operation can do both atomically.
- Promotion releases the same version in another environment. It copies neither
  content nor respondent data.
- A new session uses its environment's released version. Existing sessions keep
  the version they started with, including after a promotion or rollback.
- Closing intake is per form and environment. Releasing another version does not
  automatically reopen closed intake.

## What a user can do

Every administrative capability below also requires workspace membership and the
relevant role. Respondent entry instead requires a valid secure link or permitted
public access. Environment access alone grants no administrative action. A person
can hold several roles.

| Capability                                                 | Shared authoring                   | dev                | test               | stg                | prod                                      |
| ---------------------------------------------------------- | ---------------------------------- | ------------------ | ------------------ | ------------------ | ----------------------------------------- |
| Create and edit questions, publish question versions       | Editor                             | Shared operation   | Shared operation   | Shared operation   | Shared operation                          |
| Create and edit form drafts, rules and question references | Editor                             | Shared operation   | Shared operation   | Shared operation   | Shared operation                          |
| Preview a form draft with hypothetical answers             | Editor                             | Shared operation   | Shared operation   | Shared operation   | Shared operation                          |
| Publish an immutable form version without releasing it     | Editor                             | Shared operation   | Shared operation   | Shared operation   | Shared operation                          |
| Release a published form version                           | Not an authoring edit              | Editor or approver | Editor or approver | Editor or approver | Approver                                  |
| Publish and release a new form version atomically          | Requires publishing permission too | Editor             | Editor             | Editor             | Conditional; see below                    |
| Roll back by releasing an older eligible version           | Not an authoring edit              | Editor or approver | Editor or approver | Editor or approver | Approver                                  |
| Close or reopen intake                                     | Not an authoring edit              | Editor or approver | Editor or approver | Editor or approver | Approver                                  |
| Create or revoke environment-bound secure links            | Not an authoring edit              | Editor or approver | Editor or approver | Editor or approver | Approver                                  |
| Configure webhook endpoints                                | Not an authoring edit              | Editor or approver | Editor or approver | Editor or approver | Approver; optional second account         |
| Complete a released form as a respondent                   | Not an authoring edit              | Secure link        | Secure link        | Secure link        | Public entry when allowed, or secure link |
| Read and export responses                                  | Not an authoring edit              | Responses viewer   | Responses viewer   | Responses viewer   | Responses viewer                          |
| Erase a response                                           | Not an authoring edit              | Responses eraser   | Responses eraser   | Responses eraser   | Responses eraser                          |

"Shared operation" means the server operation has no environment scope; it is
not a recommendation to place an editor inside every environment. All environment
operations require the destination environment in the caller's grant. Response
operations additionally require the form in scope.

Configuration and version-history reads are available to the forms viewer,
editor and approver roles across their workspace. A forms viewer cannot edit,
release or read responses. An approver role alone cannot edit or publish drafts.
An editor role alone cannot perform production releases or production operational
writes, even with an environment scope of `all`.

A workspace owner administers memberships, grants and workspace settings. An
installation administrator manages installation settings, environments and accounts.
Neither role alone grants authoring, releasing or response access. Response access
requires its own grant; installation administration is not a response-data bypass.

## Release and approval constraints

- Environment names are configurable. `dev`, `test`, `stg` and `prod` are an example
  deployment, not four mandatory environments. Current authorization treats `stg`
  like other non-production environments; there is no special staging approver role.
- When both `test` and `prod` exist, a production candidate must have a prior
  release in test, or a prior production release for rollback. An unreleased draft
  cannot be a production candidate.
- A test release records availability, not a successful manual test or approval.
  There is no separate persisted test-pass gate in this workflow.
- The server does not require dev before test, or staging before production. A
  proposed mandatory dev/test/staging sequence would be a new product decision.
- In a deployment containing both test and prod, direct combined publication and
  release to prod is refused. Production releases use an existing eligible version.
- A prod-only deployment can publish and release directly when the caller has both
  editor and prod approver permissions and the second-person rule is off. Separate
  publication and release remain possible.
- A workspace can require a second person for production. Then the releasing
  approver must differ from the account that published that version, including for
  rollback. Holding both roles does not let one account satisfy this rule alone.
- The same optional rule makes production webhook changes a proposal followed by
  confirmation from another eligible account. The new endpoint stays pending until
  confirmed. Non-production operations do not use this second-person gate.
- Release history records the version, destination, actor, time and applicable
  source/approval information. Rollback adds another release record.
- Non-production respondent entry uses environment-prefixed secure links. Respondent
  data and webhook delivery remain isolated to the link's environment.

## Independent recommendation requested

Propose a clear UX using only these capabilities and constraints. Treat navigation
and the authoring/release interaction model as open design decisions.

Cover:

1. How users understand shared authoring content and environment-specific state.
2. Where question editing, draft preview, publication, verification and promotion belong.
3. How the same model handles prod-only, test/prod and dev/test/stg/prod deployments.
4. What editors, approvers, response operators and people with several roles see.
5. How destinations, version replacement, permissions, rollback and second-person
   approval are made clear before an action takes effect.
6. Which suggested behaviors need new backend policy rather than presentation alone.

Distinguish required constraints from recommendations and unresolved decisions.
Include a recommended happy path and the main failure/recovery cases.

## Evidence

- [Authorization policy](../apps/api/src/features/membership/policy.ts)
- [Route authorization](../apps/api/src/features/membership/route-policy.ts)
- [Production approval policy](../apps/api/src/features/membership/two-person.ts)
- [Production version eligibility](../apps/api/src/features/releases/workflow.ts)
- [Release transaction](../apps/api/src/features/releases/handler.ts)
- [Form publishing and settings](../apps/api/src/features/forms/handler.ts)
- [Environment schemas and capabilities](../plan/environments-and-workspaces.md)
