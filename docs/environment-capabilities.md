# Environment capabilities: UX review brief

**The navigation and publishing work this brief fed has shipped.** What an operator
sees is [the publishing and navigation guide](form-publishing-flow.md); the flow and
permission contract is the
[implementation handover](../plan/environment-navigation-implementation.md), and
[`docs/WORKSPACE_ACCESS.md`](WORKSPACE_ACCESS.md) is the normative permission model. Neither this brief
nor the interactive POC overrides it. The POC remains flow guidance and is not a
visual specification.

This brief describes domain capabilities and constraints for an independent UX
recommendation. It deliberately specifies no navigation, screen layout, control
placement or interaction sequence; the request at the end of it has been answered.
It records server capabilities, and the table below stays accurate for them.

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
- Closing a form is per form and environment. Releasing another version does not
  automatically reopen a closed form.

## What a user can do

Who may do what is specified in [`docs/WORKSPACE_ACCESS.md` section 3](WORKSPACE_ACCESS.md#role-by-act). Roles are held through access groups, each with one explicit environment set: View forms and Edit forms ignore the environment, while Publish forms, View responses and Erase responses apply only in the group's environments. There is no form scope, and administrators hold no form or response role by the role. Respondent entry instead requires a valid secure link or permitted public access.

## Release and approval constraints

- Environment names are configurable. `dev`, `test`, `stg` and `prod` are an example
  deployment, not four mandatory environments. Current authorization treats `stg`
  like other non-production environments; there is no special staging approver role.
- When both `test` and `prod` exist, a production candidate must have a prior
  release in test, or a prior production release for rollback. An unreleased draft
  cannot be a production candidate.
- A test release records availability, not a successful manual test or approval.
  There is no separate persisted test-pass gate in this workflow.
- Prerequisites are an installation-wide, versioned release-workflow configuration,
  written by a Site administrator alone and read by every form role. No
  revision is seeded, so a deployment that configures none keeps the test-before-prod
  rule above and no other ordering.
- In a deployment containing both test and prod, direct combined publication and
  release to prod is refused. Production releases use an existing eligible version.
- A prod-only deployment can publish and release directly when the caller has both
  Edit forms and Publish forms for prod and second approval is off. Separate
  publication and release remain possible.
- A workspace can require a second person for production. Then the publisher
  must differ from the account that froze that version, including for rollback.
  Holding both roles does not let one account satisfy this rule alone.
- The same optional rule makes production webhook changes a proposal followed by
  confirmation from another eligible account. The new endpoint stays pending until
  confirmed. Non-production operations do not use this second-person gate.
- Release history records the version, destination, actor, time and applicable
  source/approval information. Rollback adds another release record.
- Non-production respondent entry uses environment-prefixed secure links. Respondent
  data and webhook delivery remain isolated to the link's environment.

## Independent recommendation requested

Answered and shipped; kept for the record. The brief asked for the following.

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
