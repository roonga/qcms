# Workspace access: creation-only membership, coverage and task flows

This specification describes the proposed model and pending implementation. It replaces earlier creator-inherits-editor and protected full-management creator-group designs. Visual layout and controls remain undecided.

## Agreed direction

- Installation administrator manages accounts and installation/workspace administration. Workspace administrator is direct membership; each workspace always retains at least one active holder. Protect the last active Installation administrator too.
- The protected Form creators group is workspace-scoped, holds users only, has no form list or environment scope, and grants only creation. It does not grant view/edit/publish/response access or later administration of existing forms.
- The creator establishes initial view/edit/publish access for the new form and may select self or other eligible existing accounts. They may omit self and then have no permission to reopen the form. All such form permissions are supplied by selected groups, not direct-user grants.
- Edit forms includes View forms; publishing includes View forms and environment operations (open/close, links, webhooks). Creation no longer inherits editing/viewing.
- Form access groups remain workspace-scoped, with explicit forms, multiple permissions and independent explicit environments for each applicable permission. Groups are additive; role/environment scope cannot be borrowed across permissions. New forms/environments grant no implicit access.
- Ordinary initial creation authority does not imply response-data delegation, changing existing group memberships or changing access to other forms. Workspace administrators can arrange response access.
- Archiving cancels pending approvals, blocks new publishing and access grants, retains authorised historical reads and allows revocation. Archive prerequisites and the retained-data/session lifecycle remain undecided.
- No enabled form responsibility should be left without an effective eligible person. Empty groups, disabled/unusable accounts and pending grants do not satisfy coverage. Logged-in presence is not required.
- Second approval is off by default; a sole owner can explicitly cover all enabled responsibilities. Where enabled, exact-version/environment publishing and exact webhook changes need another eligible authorised person; self-response widening and disabling the policy are protected.
- User/account provisioning, offboarding and administrator succession remain audited. Workspace names may change, slugs stay fixed.
- All-environment grants become explicit current selections under the agreed conversion; other existing form/role migration remains out of scope.

## UX principles

- Start with a task, not record CRUD. Form, person and form access-group contexts describe the same permissions and wider effects.
- Explain the intended result, affected people/forms/environments, retained access and any required approval before confirmation.
- Explain creation-only membership separately from per-form access. Never silently add self-access or broaden an existing group to complete a flow.
- Missing responsibility must identify the action/environment and the authorised remediation, without exposing unauthorised membership information.
- Task locations below are conceptual screen responsibilities, not specified components, layouts or navigation controls.

## Decisions agreed after scenario testing

### Groups are the only form-permission path

Initial creation selects existing form access groups. Their eligible members receive the configured permissions; including self requires membership in a selected group. A creator cannot silently edit memberships or introduce direct-user form ACLs. Group administration remains with Workspace/Installation administrators. Creation-only membership remains separate from form access.

### Lifecycle coverage

Create a draft only with at least one eligible editor. Before collection in an environment, require publishing/operations, response viewing/export and erasure coverage there, plus a different eligible approver for each protected action. After closure, retained response duties and still-enabled operations remain covered. Empty groups, unusable accounts and pending grants do not count.

### Initial creation that requires approval

Hold the whole request. No active form or grants are created until approval. At application, recheck creation authority, selected groups, current editor eligibility and all relevant approval rules, then create form and assignments atomically. A saved but inaccessible pending form is not the chosen design.

### Ordinary handover and emergency suspension

Ordinary changes preserve effective coverage and administrator continuity; replacement/removal can commit atomically. Emergency suspension is an explicit audited user/account-level exception: immediately block sign-in and sessions, make every group permission ineffective, retain memberships and record uncovered responsibilities. It may include the last administrator. Affected actions remain blocked until authorised replacement or deployment-operator recovery; never grant an implicit replacement.

### Approval readiness belongs to the requested action

Drafts have no permanent two-publisher requirement. For a protected action, validate a different currently eligible authorised approver for the exact form/environment and frozen change. An unavailable approver blocks that action. The baseline matrix includes explicit publishing requests, which explains why some configurations still correctly refuse them.

### Remaining policy and implementation work

Define archive prerequisites and retained-data/session handling; finish approval action/environment coverage and the operator recovery procedure. Application routes/storage, authorisation, auditing, real session invalidation and transaction safety remain implementation work. No code change is claimed by these design decisions.

## Permission matrix

| Permission                              | View | Edit | Create | Publish/operate | View/export responses | Erase |
| --------------------------------------- | ---- | ---- | ------ | --------------- | --------------------- | ----- |
| View forms                              | Yes  | No   | No     | No              | No                    | No    |
| Edit forms                              | Yes  | Yes  | No     | No              | No                    | No    |
| Create forms / Form creators membership | No   | No   | Yes    | No              | No                    | No    |
| Publish forms                           | Yes  | No   | No     | Yes             | No                    | No    |
| View and export responses               | No   | No   | No     | No              | Yes                   | No    |
| Erase responses                         | No   | No   | No     | No              | No                    | Yes   |

## Starter groups

| Group            | Purpose                                                                                                                    | Protection                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Form creators    | Create new forms in this workspace. No form list or environment selection; no inherited view/edit/publish/response access. | Protected from deletion    |
| Form editors     | View and edit assigned forms.                                                                                              | Ordinary form access group |
| Form viewers     | View assigned form definitions.                                                                                            | Ordinary form access group |
| Form publishers  | Publish and operate assigned forms in explicitly selected environments.                                                    | Ordinary form access group |
| Response viewers | View and export responses for assigned forms in selected environments.                                                     | Ordinary form access group |
| Response erasers | Erase responses for assigned forms in selected environments, without answer-reading permission.                            | Ordinary form access group |

Form access groups can combine the non-creation capabilities for a team that handles everything. This does not restore creation inheritance or make that bundle a protected creation group.

## Screen and flow catalogue

| Screen or flow                     | Conceptual location                                                  | User task                                                                                                                                                                                                             | Authority                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| My account                         | Personal account                                                     | Maintain my password and authentication, recover access through the supported process, or sign out.                                                                                                                   | Signed-in user                                                                                                       |
| My access                          | Personal account                                                     | Understand my workspaces, permitted forms/actions/environments and the groups supplying them.                                                                                                                         | Signed-in user                                                                                                       |
| Accounts                           | Site configuration → Accounts                                        | Find an account and start onboarding, offboarding or administrator succession.                                                                                                                                        | Installation administrator                                                                                           |
| Create account                     | Site configuration → Accounts → Create account                       | Create an ordinary account with provisional credentials and no automatic workspace permissions.                                                                                                                       | Installation administrator                                                                                           |
| Manage account                     | Site configuration → Accounts → Person                               | Disable/reactivate accounts, arrange recovery and administrator succession, and inspect affected form responsibilities. Emergency suspension is an audited account-level exception with authorised operator recovery. | Installation administrator                                                                                           |
| Workspaces                         | Workspace area                                                       | Find a workspace the person may administer. Other users choose among their granted workspaces without gaining administration access.                                                                                  | Installation administrator / Workspace administrator                                                                 |
| Create workspace                   | Workspace area → Create workspace                                    | Name the workspace, appoint its first active Workspace administrator and establish its starter groups, including the protected creation-only Form creators group.                                                     | Installation administrator                                                                                           |
| Members                            | Workspace → Members                                                  | Find a person, give/change/remove their workspace access, or arrange Workspace administrator succession.                                                                                                              | Workspace administrator / Installation administrator                                                                 |
| Manage a person’s workspace access | Workspace → Members → Person                                         | Understand that person’s effective access, grant/revoke group memberships, and review consequences before applying a change.                                                                                          | Workspace administrator / Installation administrator                                                                 |
| Access groups                      | Workspace → Access groups                                            | Find a team arrangement, understand its purpose and start giving or changing access.                                                                                                                                  | Workspace administrator / Installation administrator                                                                 |
| Create access group                | Workspace → Access groups → Create group                             | Define a custom team arrangement using fixed permissions, explicit forms and separate environment selections where needed.                                                                                            | Workspace administrator / Installation administrator                                                                 |
| Manage group access                | Workspace → Access groups → Group                                    | Manage holders and assigned forms/permissions for a form access group. Form creators has membership only, without form or environment assignments.                                                                    | Workspace administrator / Installation administrator                                                                 |
| Forms                              | Workspace → Forms                                                    | Find an authorised form and continue the task: edit, manage access, publish, operate or work with responses.                                                                                                          | According to form permissions; administrators receive only metadata needed to manage access                          |
| Create form                        | Workspace → Forms → Create form                                      | Create a form, choose its initial viewers/editors/publishers, and verify effective responsibility coverage before the creation becomes usable.                                                                        | Active eligible member of Form creators in that workspace                                                            |
| Form access                        | Workspace → Forms → Form → Access                                    | Explain effective access and who supplies it; assign or remove form access within administrative authority. Initial access uses groups only, with no direct-user permission path.                                     | Workspace administrator / Installation administrator; ordinary form users receive no new access-management authority |
| Edit form                          | Workspace → Forms → Form → Edit                                      | Build the shared draft. Save editing work without selecting an environment or publishing it.                                                                                                                          | Edit forms on the assigned form; Form creators membership alone is insufficient                                      |
| Publish form                       | Workspace → Forms → Form → Publish                                   | Review the exact version and destination environments, request approval if required, and make the authorised version live.                                                                                            | Publish forms for each destination                                                                                   |
| Operate a published form           | Workspace → Forms → Form → Selected environment                      | Open/close the form, manage respondent links and configure webhooks; understand whether the change is live or awaiting approval.                                                                                      | Publish forms for that form/environment                                                                              |
| Responses                          | Workspace → Forms → Form → Selected environment → Responses          | Find submitted responses, inspect them and export within the same authorised scope.                                                                                                                                   | View and export responses                                                                                            |
| Erase responses                    | Workspace → Forms → Form → Selected environment → Erase responses    | Identify the intended responses, understand the irreversible effect and carry out erasure without needing answer-reading permission.                                                                                  | Erase responses                                                                                                      |
| Approval requests                  | Workspace → Approvals                                                | Review exact changes with an eligible independent approver. Pending access does not count toward effective coverage; initial approval holds the whole creation request.                                               | Requester or appropriately authorised independent approver                                                           |
| Workspace settings                 | Workspace → Settings                                                 | Rename the workspace and manage its security policy, with separate approval for disabling second approval.                                                                                                            | Workspace administrator / Installation administrator                                                                 |
| Archive workspace                  | Workspace → Archive                                                  | Understand blockers and retained access, confirm the end-of-life action and cancel pending approvals. Retained-form/session/data rules remain undecided.                                                              | Workspace administrator / Installation administrator                                                                 |
| Audit history                      | Workspace → Audit; installation account events in Site configuration | Explain who changed access or performed an audited action, what was affected and whether approval was involved.                                                                                                       | Workspace administrator within their workspace / Installation administrator                                          |

### In the form creation flow

Membership in Form creators is checked at workspace scope. The creator chooses initial viewers, editors and publishers for this new form, including themselves if appropriate. They see only authorised account/group metadata. Validate actual effective coverage and explain any missing role or approval. Do not broaden an existing group’s membership behind the scenes; how individual selections map to data remains a pending decision.

### When granting or changing access

Start from the form, person or form access group. Explain the affected people, forms, roles and environments. Recheck effective coverage and action-specific approvals in the final state. Creation-only membership does not permit editing access on other forms.

### When arranging response access

A Workspace administrator supplies form/environment response grants before collecting responses under the proposed lifecycle rule. Do not silently extend an ordinary creator’s initial delegation authority to response data.

### When handing over a responsibility

Identify a replacement who is eligible and has the exact form/action/environment permission. Apply the replacement and removal together, preserving coverage. Removing one source of access may leave other grants effective.

### When suspending an account

Show all affected workspace administrator and form responsibilities. Ordinary removal safeguards are agreed; handling a compromised sole operator is an unresolved policy and cannot be represented as an automatic bypass.

### When publishing or approving

Check every destination and the exact frozen version. A different currently authorised approver is required where enabled. Pending grants, unrelated accounts and permissions in another environment cannot satisfy approval coverage.

## Current code and required tasks

The existing implementation has not been changed. Creation has no initial-access body; group scope is still mandatory; form scope is currently response-only; account suspension is not verified by the session gate. These remain implementation gaps.

| ID  | User outcome                                          | Authority                                                                | Current code                                                                        | Pending                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Provision and find accounts                           | Installation administrator                                               | Missing ([source](../apps/api/src/features/auth/route.ts))                          | Create ordinary accounts with no privilege; initial credentials require change; installation role assignment is explicit.                                                                                                                 |
| A02 | Disable, reactivate and recover an account            | Installation administrator                                               | Missing ([source](../apps/api/src/features/auth/reset-two-factor.ts))               | Revoke sessions on suspension, preserve audit identity and arrange administrator succession before disabling the last one.                                                                                                                |
| A03 | Appoint or remove Installation administrators         | Installation administrator                                               | Missing ([source](../packages/db/src/schema/control/auth.ts))                       | Explicit audited promotion/demotion; preserve the last active Installation administrator under concurrent changes.                                                                                                                        |
| A04 | Maintain my credentials and sign out                  | Signed-in person                                                         | Existing foundation ([source](../apps/api/src/middleware/admin-auth.ts))            | Forced password change, factor enrollment and recovery remain usable for a zero-privilege account.                                                                                                                                        |
| A05 | Understand my effective access                        | Signed-in person                                                         | Partial ([source](../apps/api/src/features/membership/handler.ts))                  | Explain permitted actions, forms, environments and contributing groups; distinguish pending changes and no-access state.                                                                                                                  |
| W01 | Find an authorised workspace                          | Installation administrator / Workspace administrator / granted user      | Defect ([source](../apps/api/src/features/workspaces/handler.ts))                   | Installation administrators may find all; Workspace administrators only those administered; others only their granted workspace choices.                                                                                                  |
| W02 | Create workspace and creator membership foundation    | Installation administrator                                               | Partial ([source](../apps/api/src/features/workspaces/schema.ts))                   | Protected creation-only Form creators plus starter form access groups; active first Workspace administrator; no implicit content access.                                                                                                  |
| W03 | Maintain Workspace administrator succession           | Workspace administrator / Installation administrator                     | Partial ([source](../apps/api/src/features/membership/handler.ts))                  | Direct membership replaces owner role; ordinary succession preserves the last active Workspace administrator; emergency suspension is the explicit audited exception.                                                                     |
| W04 | Rename a workspace and govern its security settings   | Workspace administrator / Installation administrator                     | Partial ([source](../apps/api/src/features/membership/handler.ts))                  | Rename only the name; slug stays fixed. Disabling second approval needs a different authorised person.                                                                                                                                    |
| W05 | Archive a used workspace safely                       | Workspace administrator / Installation administrator                     | Conflict ([source](../apps/api/src/features/workspaces/handler.ts))                 | Archive rules for retained forms, live sessions and response lifecycle remain undecided; cross-workspace form moves are excluded.                                                                                                         |
| G01 | Understand creation membership and form access groups | Workspace administrator / Installation administrator                     | Pending ([source](../apps/admin/components/membership/access-groups-panel.tsx))     | Form creators has people only and no form/environment scope. Form access groups retain explicit forms and role-specific environments.                                                                                                     |
| G02 | Configure form access groups                          | Workspace administrator / Installation administrator                     | Pending ([source](../apps/api/src/features/membership/schema.ts))                   | Creation-only membership is separate. Validate all form access groups and their effective holders; initial recipients are represented only through access groups.                                                                         |
| G03 | Delegate form creation or form access                 | Workspace administrator / Installation administrator                     | Partial ([source](../apps/admin/components/membership/members-panel.tsx))           | Adding a person to Form creators permits creation only. Separate form permissions are required even for the creator.                                                                                                                      |
| G04 | Review access changes and responsibility coverage     | Workspace administrator / Installation administrator                     | Defect ([source](../apps/api/src/features/membership/handler.ts))                   | Compute final effective role/form/environment coverage, independent approvers and conditional self-widening checks before applying ordinary changes.                                                                                      |
| G05 | Revoke group access without losing coverage           | Workspace administrator / Installation administrator                     | Partial ([source](../apps/api/src/features/membership/route.ts))                    | Form creators remains protected from deletion; revoking its membership removes creation only. Form access removal checks enabled responsibilities and remaining grants.                                                                   |
| G06 | Explain a person's effective permissions              | Workspace administrator / Installation administrator; self view for user | Pending ([source](../apps/api/src/features/membership/policy.ts))                   | Show each contributing group and its form/role/environment scope. Role hierarchy expands actions, never form scope.                                                                                                                       |
| F01 | View only authorised form content                     | View forms, Edit forms or Publish forms                                  | Partial ([source](../apps/api/src/features/membership/policy.ts))                   | Enforce explicit selected forms for reads, direct IDs, previews, assistant and operations metadata; View forms contract still needs clarification.                                                                                        |
| F02 | Create a form with initial people and coverage        | Form creators member in the workspace                                    | Pending ([source](../apps/api/src/features/forms/schema.ts))                        | Creation-only member chooses initial view/edit/publish recipients, including self. No inherited access. Reject uncovered effective actions; required approval holds the entire creation request; initial form permissions are group-only. |
| F03 | Edit a separately authorised draft                    | Edit forms on the assigned form                                          | Partial ([source](../apps/api/src/features/membership/policy.ts))                   | Edit forms implies View forms. Create forms no longer implies either. At least one eligible editor is the proposed draft checkpoint.                                                                                                      |
| F04 | Publish only when authority and coverage are ready    | Publish forms for each destination                                       | Partial ([source](../apps/api/src/features/releases/handler.ts))                    | Authorise all destinations, exact version and distinct eligible approver where needed; proposed environment-activation coverage includes response handling.                                                                               |
| F05 | Open or close forms and manage respondent links       | Publish forms in selected environment                                    | Existing foundation ([source](../apps/api/src/features/membership/route-policy.ts)) | Publish forms permits these actions for explicitly assigned forms/environments; approval coverage for these actions remains undecided.                                                                                                    |
| F06 | Configure webhooks and approve their changes          | Publish forms in selected environment                                    | Partial ([source](../apps/api/src/features/webhooks/handler.ts))                    | Publish forms controls the exact form/environment; independent approval binds to the exact configuration where enabled.                                                                                                                   |
| R01 | Maintain response viewing/export coverage             | View and export responses in selected environment                        | Existing foundation ([source](../apps/api/src/features/responses/admin/route.ts))   | Explicit role/form/environment grants; proposed collection and retained-data responsibilities require eligible accounts.                                                                                                                  |
| R02 | Maintain response erasure coverage                    | Erase responses in selected environment                                  | Existing foundation ([source](../apps/api/src/features/responses/admin/route.ts))   | Separate erasure authority in each collecting/retained-data environment; no answer-reading implication.                                                                                                                                   |
| P01 | Request, review and decide protected changes          | Action-specific authorised approver                                      | Partial ([source](../apps/api/src/features/membership/two-person.ts))               | Provide exact target, version/configuration, requester, current authority, outcome and cancellation; stale or self-approval cannot apply.                                                                                                 |
| P02 | Trace access, security and assistant actions          | Workspace administrator / Installation administrator                     | Partial ([source](../apps/admin/components/membership/audit-panel.tsx))             | Find readable actor, action, target, before/after scope and approval identities; keep cross-workspace confidentiality.                                                                                                                    |
| S01 | Assign access accurately at organisational scale      | All list/picker users as authorised                                      | Pending ([source](../packages/db/src/queries/grants.ts))                            | Find accounts/forms/groups among 1,000 accounts and 1,000 groups; review multi-person changes and bounded outcomes without repeated work.                                                                                                 |
| S02 | Recover safely without silently bypassing policy      | Deployment operator; audited recovery only                               | Partial ([source](../apps/api/src/features/auth/reset-two-factor.ts))               | Implement audited account-level emergency suspension, including the last administrator, and authorised operator recovery; ordinary changes preserve coverage.                                                                             |

## Broader scenario matrix

The [reproducible scenario runner](workspace-access-scenarios.mjs) completed **4,467/4,467 assertions** across **369 configurations**, with **39 additional targeted cases**. There were 317 ready configurations and 52 expected blocked configurations. Refusal assertions passing does not mean those configurations complete the business workflow.

- Users: 1, 2, 10, 100 and 1,000 total accounts.
- Environments: test only, prod only, or dev/test/prod.
- Workspaces: 1 or 3; forms per workspace: 1 or 10.
- Shared and departmental access; nine additional fixtures with 1,000 groups.
- Approval off, prod-only and all-environment variants are sensitivity assumptions, not three newly agreed settings.
- [HTML results](workspace-access-scenario-results.html), [test cases and actual outcomes](workspace-access-test-cases.md), and [full JSON evidence](workspace-access-scenario-results.json).

These are standalone model tests. They do not implement initial recipient storage, form creation, approval request transitions, real suspension, actual database locking, UX usability or performance/load verification. The earlier 35 focused checks below are separate, overlapping model evidence.

### Independent scenario-test review

The independent reviewer checked configuration totals, saved results and runner fingerprint, and accepted the report’s separation of model evidence from product/load claims. Requested improvements were applied: T21-T26 test disjoint/overlapping form scopes and non-empty independent role environments; creation-membership removal now checks retained editing for the same account. The final rerun passed 4,467 assertions. Three browser checks verified evidence counts/source fingerprint, report filtering and desktop/mobile layout. Remaining product-policy decisions are not resolved by these test passes.

## Executed design-model tests

**35 checks passed; 0 failures, 0 errors.** These are standalone permission-model checks, not application, API, database or scale tests.

- Creation before forms exist; creator receives no automatic view/edit/publish/response access.
- Explicit assignment of self or another editor; empty, disabled, provisional and pending holders fail effective coverage.
- Draft obligations versus collecting-environment obligations are exercised as declared inputs, not ratified lifecycle policy.
- Exact form/workspace/environment scope, response-role environment not supplying publication, erasure without answer reading, and additive grants.
- Atomic replacement preserves coverage; two stale checks can jointly orphan a form; serialised checks reject the second invalid removal. No real database locks are tested.
- A sole explicitly authorised user covers ordinary actions with second approval off; a distinct eligible publisher is needed for independent approval.
- Strict sole-editor suspension is rejected by the model, exposing the emergency-recovery tradeoff rather than approving that policy.
- A form persisted with pending-only editing grants is uncovered. This is a counterexample to immediately usable pending creation.

## Completeness criteria

Keep 28 stable task IDs with UX, API/data invariants, permission/refusal and lifecycle/concurrency/scale evidence. Source code presence or passing design-model checks do not mark these tasks implemented.

- Solo acceptance: first workspace, creation-only membership, explicit self assignment, drafting, publishing, links/webhooks, response view/export/erase, ordinary handover and credential recovery with second approval off.
- Enterprise acceptance: 1,000 accounts and 1,000 groups with overlapping access; scope isolation; efficient assignment/search; independent approvals; atomic succession and revocation. Performance targets remain to be ratified and measured.
- Coverage refusal must be action/environment-specific, count effective eligible people and recheck current authority when applying approvals.
- Do not ship with access leaks, accidental creator inheritance, silent response delegation, lost last-administrator coverage or unresolved implementation assumptions disguised as policy.

## Independent-review status

The earlier independent review returned CONDITIONAL ACCEPT and identified lifecycle, recipient, pending-creation and suspension decisions. The user has since agreed the rules recorded above; this does not claim a new implementation review. The reviewer also required effective-account coverage, atomic final-state checks, bounded initial allocation authority and no implicit creator access. Follow-up review conditionally accepted the updated design documentation. Its lifecycle clarifications and missing creation-workspace check have been addressed; remaining archive/approval-scope/recovery details remain explicit.

## Out of scope

Shared/reusable-question management, moving forms between workspaces, and existing form/role migration except the agreed explicit-environment conversion. Ordinary form-local question editing must still work. Visual UI decisions are not made here.
