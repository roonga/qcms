# Workspace access

The user guide for these rules is [`docs/workspace-access-guide.html`](workspace-access-guide.html).

## 1. Status and authority

- This document is the single source of truth for workspace access in QCMS: accounts, administrators, workspaces, access groups, roles, environments, second approval, audit and the screens that manage them.
- Decision records (ADR-41, SEC-1, SEC-3, SEC-15, SEC-17, `plan/environments-and-workspaces.md`, `plan/workspaces-review.md`) link here for anything this document covers. Where one of them disagrees with this document, this document holds; section 15 lists what this document replaced.
- QCMS is green field for this model: schema changes take the new shape directly, with no data migration, upgrade path or backward compatibility.
- Tests are written against the real policy code as each task lands. Section 14 lists the cases they must cover, and `plan/work-order-sequence.md` names the one task that owns each.
- The access rules for workspace themes and the appearance lock come from agent-builder rulings Q10 and Q18 (`plan/agent-builder-decisions.md`) and are stated here.

| Area                                                              | Status       |
| ----------------------------------------------------------------- | ------------ |
| Workspaces, forms and questions owned by one workspace            | Built        |
| Environment scope enforced in the API per route                   | Built        |
| Access groups with several roles and one explicit environment set | Not built    |
| Five roles, View forms to Erase responses                         | Not built    |
| Workspace administrator as a direct membership flag               | Partly built |
| Site administrator as an explicit, non-default role               | Not built    |
| One user-facing Publish step                                      | Not built    |
| Second approval for `prod` publish and endpoint changes           | Built        |
| Second approval for turning the rule off and for self-grant       | Partly built |
| Account creation, disable, reactivation and reset in the app      | Not built    |
| Site administrator appointment with approval requests             | Not built    |
| Workspace audit (SEC-15)                                          | Built        |
| Site audit and mirroring                                          | Not built    |
| Workspace list narrowed to the caller's own                       | Not built    |
| Workspace rename, Move form screen, shared library screen         | Not built    |
| Archive refused while any form remains                            | Built        |
| Assistant tools follow the user's grants (SEC-17)                 | Built        |
| Workspace themes and the workspace appearance lock                | Not built    |

- Records that describe what is built (`docs/SECURITY_DESIGN.md`, the operator guides, the built-task notes in ADR-41) keep that description until the code changes, with a line pointing here.
- The SEC-3 role table in `docs/SECURITY_DESIGN.md` §3.2 stays as built, because `apps/api/e2e/security/matrix-coverage.e2e.ts` reads it. It changes with the foundation task that changes the roles in code.

## 2. Glossary

| Term                    | Meaning                                                                                                                                             | Replaces                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Account                 | One person's sign-in identity on the site.                                                                                                          | user                                                                   |
| Unclaimed account       | An account whose emailed sign-in link has not yet been used.                                                                                        | provisional account                                                    |
| Site administrator      | Administers the whole site: accounts, workspaces, Site administrators, site settings. Reads no data by the role.                                    | installation admin, Installation administrator, installation claim     |
| Workspace administrator | Administers one workspace: its people, access groups, settings, audit and archive. Reads no data by the role.                                       | Workspace owner, `forms.owner`                                         |
| Workspace               | The only access zone. Owns forms and questions.                                                                                                     |                                                                        |
| Environment             | A named data plane such as `test` or `prod`.                                                                                                        |                                                                        |
| Access group            | A set of roles plus one environment set, in one workspace, with the people in it.                                                                   | team                                                                   |
| People in this group    | The accounts that are members of an access group.                                                                                                   | holders                                                                |
| Members                 | The list label for a workspace's people in the Workspace area.                                                                                      | People                                                                 |
| View forms              | Role: read forms, questions, versions and publish history.                                                                                          | Form viewer, `forms.viewer`                                            |
| Edit forms              | Role: draft and edit forms and questions, preview.                                                                                                  | Form editor, `forms.editor`                                            |
| Publish forms           | Role: publish to an environment, open and close, links, webhooks.                                                                                   | Release approver, `forms.approver`, Release forms, Release and operate |
| View responses          | Role: view and export responses.                                                                                                                    | Response viewer, `responses.viewer`, handler                           |
| Erase responses         | Role: erase responses without reading them.                                                                                                         | Response eraser, `responses.eraser`, eraser                            |
| Publish                 | Make a version live in an environment, freezing the draft first when publishing a draft.                                                            | release, publish-and-release (for forms)                               |
| Version                 | A frozen, numbered form definition. The same version moves from `test` to `prod`.                                                                   | published version                                                      |
| Second approval         | Workspace setting requiring a second person for named `prod` acts.                                                                                  | two-person rule, approver-not-author, `requireSecondApprover`          |
| Approver                | The second person under second approval.                                                                                                            | second approver                                                        |
| Grant, Revoke           | Add a person to, or remove them from, an access group.                                                                                              | Give access, Remove access                                             |
| Authors                 | Starter group: Edit forms, Publish forms, View responses; every environment but `prod`. Edit forms only on a site whose only environment is `prod`. | Builders, Form editors                                                 |
| Publishers              | Starter group: Publish forms; `prod`.                                                                                                               | Releasers, Form publishers                                             |
| Response viewers        | Starter group: View responses; `prod`.                                                                                                              | Response readers                                                       |
| Response erasers        | Starter group: Erase responses; `prod`.                                                                                                             |                                                                        |

## 3. The model

- **Accounts** are site-wide. An account holds nothing by default.
- **Site administrator** is an explicit role on an account. It administers every workspace as a Workspace administrator would, plus the site-level acts in the matrix.
- **The workspace is the only access zone.** There is no per-form authorisation anywhere, response roles included. A site that wants separate zones creates workspaces.
- **Workspace administrator** is a direct flag on a person's membership of one workspace.
- **An access group** belongs to one workspace and carries a set of roles and one environment set. People in the group hold every role in it, in every environment in the set, for every form in the workspace.
- **Roles are additive across groups.** A person in two groups holds the union.
- **Environments are named explicitly** on each group. There is no "all environments" value. A newly added environment is covered by no group until an administrator adds it to a group.
- **View forms and Edit forms ignore the environment set.** A group holding only those roles shows no environment picker.
- **Publish forms, View responses and Erase responses apply only in the group's environments.** A group carrying any of them names at least one environment; saving one with none is refused, on every site.
- **Administrators administer and hold no form or response role** unless they are also in a group that grants one.
- **The production split stays visible**: a person who builds in `test` and publishes to `prod` is in two groups.
- **Form creation and form lifecycle change no group.** Creating a form picks no group; the workspace's groups apply to it at once.

### Role by act

`yes` means always; `env` means only in an environment in the group's environment set; blank means refused. The Site administrator column applies in every workspace.

| Act                                                                     | View forms   | Edit forms         | Publish forms             | View responses | Erase responses | Workspace administrator | Site administrator |
| ----------------------------------------------------------------------- | ------------ | ------------------ | ------------------------- | -------------- | --------------- | ----------------------- | ------------------ |
| Read forms, questions, versions and publish history                     | yes          | yes                | yes                       |                |                 |                         |                    |
| Read link and endpoint configuration                                    | yes (masked) | yes                | env                       |                |                 |                         |                    |
| Draft and edit forms and questions, pin shared questions, preview       |              | yes                |                           |                |                 |                         |                    |
| Publish a draft to an environment (freezes the next version)            |              | with Publish forms | env, with Edit forms      |                |                 |                         |                    |
| Publish an existing version to an environment                           |              |                    | env                       |                |                 |                         |                    |
| Open or close a form                                                    |              |                    | env                       |                |                 |                         |                    |
| Mint or revoke links                                                    |              |                    | env                       |                |                 |                         |                    |
| Configure webhook endpoints                                             |              |                    | env                       |                |                 |                         |                    |
| Approve a `prod` publish or endpoint change under second approval       |              |                    | `prod`, not the requester |                |                 |                         |                    |
| Discover operational form metadata in an environment                    | yes          | yes                | env                       | env            | env             |                         |                    |
| Read the release-workflow configuration                                 | yes          | yes                | env                       |                |                 |                         |                    |
| View and export responses                                               |              |                    |                           | env            |                 |                         |                    |
| Erase responses                                                         |              |                    |                           |                | env             |                         |                    |
| Move a form to another workspace                                        |              | in both workspaces |                           |                |                 | approve, in the source  | approve            |
| Derive a workspace theme from a website (SEC-18)                        |              | yes                |                           |                |                 |                         |                    |
| Save or change a workspace theme                                        |              | yes                |                           |                |                 |                         |                    |
| Set or clear the workspace appearance lock                              |              |                    |                           |                |                 | yes                     | yes                |
| See people and access groups                                            |              |                    |                           |                |                 | yes                     | yes                |
| Grant, Revoke; create, change or delete access groups                   |              |                    |                           |                |                 | yes                     | yes                |
| Appoint or remove a Workspace administrator                             |              |                    |                           |                |                 | yes                     | yes                |
| Re-confirm a suspended response membership                              |              |                    |                           |                |                 | yes                     | yes                |
| Workspace settings: rename, second approval                             |              |                    |                           |                |                 | yes                     | yes                |
| Read the workspace audit                                                |              |                    |                           |                |                 | yes                     | yes                |
| Archive the workspace                                                   |              |                    |                           |                |                 | yes                     | yes                |
| Create a workspace and name its first Workspace administrator           |              |                    |                           |                |                 |                         | yes                |
| Mark or unmark the shared question library                              |              |                    |                           |                |                 |                         | yes                |
| Create, disable, reactivate an account; reset its credentials or factor |              |                    |                           |                |                 |                         | yes                |
| Browse and search the account directory                                 |              |                    |                           |                |                 |                         | yes                |
| Promote or demote a Site administrator; decide approval requests        |              |                    |                           |                |                 |                         | yes                |
| Read the site audit                                                     |              |                    |                           |                |                 |                         | yes                |
| Release-workflow configuration, environment settings                    |              |                    |                           |                |                 |                         | yes                |
| Read the site-wide dead-letter list                                     |              |                    |                           |                |                 |                         | yes                |
| Read the site-wide erasure log                                          |              |                    |                           |                |                 |                         | yes                |
| Read any response by virtue of the administrator role                   |              |                    |                           |                |                 | never                   | never              |

- "Masked" is the endpoint URL with its query string masked, done by the API.
- Moving a form needs Edit forms in both workspaces. With second approval off in the source, either the mover is a Workspace administrator of the source or the move waits for one, or a Site administrator, to approve it. With it on, every move waits for an approver other than the mover (section 9).
- There is no act that moves a question between workspaces. The built route `POST /admin/questions/{id}/workspace` is removed by the foundation task.
- With second approval on, a Grant or group change that gives the person making it a response role, or a new environment for one, waits for an approver (section 6).
- Nobody re-confirms their own suspended membership. Re-confirming is also refused for the person who performed the reset or reactivation, where an active, claimed administrator other than that person and the subject exists (section 7).
- Every account, administrator or not, manages its own password, second factor, recovery codes and sessions, and reads its own access (My access).
- The shared question library keeps its design: every workspace's Edit forms holders see and pin its questions; only Edit forms holders in the shared workspace edit them.
- A form's appearance is part of its draft: editing it is a draft edit (Edit forms) and freezes with the version. While the workspace appearance lock is set, the API refuses every draft save that changes appearance, for every actor and for the assistant (section 9).
- Setting or clearing the appearance lock is a workspace setting: it needs no second approval, even with the rule on, and writes one `setting` row in the workspace audit. That a Site administrator may set it, as for the other workspace settings, is a proposed default (section 16).
- The logo route serves a workspace theme's stored raster logo to anyone, respondents included, without a session. It is not an act in the matrix: it reads no form, version or response and takes no grant (section 9).
- The rows on workspace themes follow the agent-builder rulings Q10 and Q18 in `plan/agent-builder-decisions.md`.

## 4. Starter groups

Every new workspace is created with four starter groups. They are ordinary groups: renamable, editable and deletable.

| Group            | Roles                                     | Environments                 |
| ---------------- | ----------------------------------------- | ---------------------------- |
| Authors          | Edit forms, Publish forms, View responses | Every environment but `prod` |
| Publishers       | Publish forms                             | `prod`                       |
| Response viewers | View responses                            | `prod`                       |
| Response erasers | Erase responses                           | `prod`                       |

- On a site with `test` and `prod`, Authors covers `test`. On a site with more environments, such as `dev`, Authors covers every non-prod environment the site has when the workspace is created.
- On a site whose only environment is `prod`, Authors carries Edit forms only, with no environment set, because a group carrying Publish forms or View responses must name an environment (section 3).
- Starter groups are not protected. Administrators name their own groups and may rename or delete any group, starter groups included.
- When a role or environment is left with no group, for example after a starter group is deleted, Access groups shows the "no group covers this" notice (section 13).
- A new workspace's starter groups have no people, except on a one-person site.
- **One-person site**: the first account is Site administrator, Workspace administrator of the first workspace and a member of all four starter groups. Second approval is off.
- There is no Form creators group and no setting that seeds response access for new editors.

## 5. Publishing

- The user-facing step for forms is **Publish to `<environment>`**. "Release" is not part of the forms vocabulary in the UI.
- **Publishing a draft** freezes it as the next numbered version and makes that version live in the chosen environment, in one act. It needs Edit forms and Publish forms for that environment. The one exception is a draft publish to `prod` under second approval on a site whose only environment is `prod`, applied on approval (section 6).
- **Publishing an existing version** to another environment makes the same version live there. Nothing is frozen or changed. It needs Publish forms for that environment.
- Edit forms alone cannot freeze a version.
- The data model keeps frozen, numbered versions: the same version goes from `test` to `prod`, history is kept, and rollback is publishing an earlier version. Code identifiers and API paths such as `releases` may keep their names.
- Where the site has a non-prod environment, `prod` accepts only a version already published to a non-prod environment, and a draft is never published straight to `prod`. This is a fixed rule: no workspace setting or release-workflow configuration can permit it.
- On a site whose only environment is `prod`, a draft may be published to `prod`. With second approval off it is applied at once. With it on, the publish is a request: another person approves it, and the freeze and the publish are applied together on approval. There is no separate freeze step.
- Default: questions keep "Publish" with its current meaning, freezing a pinnable version with no environment.
- The single Publish step is its own task: the form Publish tab, the release-workflow screens, the assistant publish cards and forms-area copy.

## 6. Second approval

- A per-workspace setting, off by default. It applies in `prod` only.
- **Covered acts in `prod`:** publishing a version, and changing a webhook endpoint. Links and open or close are not covered.
- **Publishing a version to `prod`:** refused for the account that froze that version. A different person holding Publish forms for `prod` in that workspace publishes it and is recorded as the approver. This stays inline on the form; there is no separate approvals queue for publish approvals.
- **Publishing a draft to `prod` on a site whose only environment is `prod`:** creates an approval request and freezes nothing. A different person holding Publish forms for `prod` in that workspace approves it on the form and is recorded as the approver; the draft is then frozen as the next version and made live in `prod` in one act. The requester is recorded as the person who froze the version and the approver as the approver, so the rule above applies to the requester for any later publish of that version to `prod`. The request expires after 7 days, like the workspace approval requests below. It is approved on the form only: it is not a workspace approval request and appears neither in the Requests row of the Audit screen nor under Approval requests in Site configuration. It is audited (section 11).
- **A held draft publish applies the draft as it was when requested.** The request is tied to the draft's content at request time, its questions and its appearance alike, and the approver is shown exactly that content. If the draft has changed since the request, an appearance-only change included, the approval is refused with "This draft has changed since publishing was requested. Request publishing again." and the requester makes a new request.
- **Endpoint change in `prod`:** one holder of Publish forms for `prod` proposes it; it is held and not live until a different holder of Publish forms for `prod` confirms it.
- **While the rule is on, two administrative acts need an approver:**
  - turning the rule off;
  - a **self-grant**: any change that gives the person making it a response role, or a new environment for a response role. This covers adding yourself to a group that carries a response role, adding a response role or an environment to a group you are in, and joining a group and then editing it.
- A pending self-grant request is bound to the group's roles and environments at the time of the request. Approving it grants those, never a role or environment added to the group afterwards.
- **Approver for those two acts:** a different Workspace administrator of that workspace, or a Site administrator who is not the requester. A Site administrator who is not the requester can always act as the approver.
- **Workspace approval requests:** each of those two acts, and a Move form held for approval (section 9), creates a stored request that does not take effect until an approver approves it. The request is listed in the Requests row of that workspace's Audit screen for its Workspace administrators, and under Approval requests in Site configuration for Site administrators. A request expires after 7 days and can then no longer be approved.
- **Turning the rule on** is refused in a workspace where nobody else could approve: no second administrator, or no second holder of Publish forms for `prod`. A Site administrator who is not the requester counts as the second administrator. The second holder of Publish forms for `prod` is the approver of every `prod` publish, a draft publish on a site whose only environment is `prod` included.
- **While the rule is on and nobody else could approve**, for example after the second administrator is disabled, Settings shows a warning saying so.
- Approver equals requester is always refused.
- **A held request is re-checked when it is approved and applied**, not only when it is made. This covers a Move form, a self-grant, a draft publish to `prod` on a site whose only environment is `prod`, and turning the rule off. The requester must still hold what the act needs: for a move, Edit forms in both workspaces and a destination that is not archived; for the publish, Edit forms and Publish forms for `prod`; for a self-grant or turning the rule off, being a Workspace administrator of that workspace or a Site administrator. Otherwise the approval is refused and nothing is applied.
- An unclaimed or disabled account cannot be an approver, and is not counted as the second administrator or the second holder of Publish forms for `prod` when the rule is turned on or when Settings decides whether to show the warning.
- With the rule off, an administrator may grant themselves response access. The grant and every later read are audited. Turning second approval on is how a workspace requires another person.

## 7. Accounts

### Creation

- A Site administrator creates an account by email address.
- The server generates a single-use sign-in link that expires after 72 hours and emails it straight to that address. No administrator chooses, sees or receives a password or the link.
- First sign-in forces the person to set a password and enrol a second factor.
- Until then the account is **unclaimed**. Account creation, and every grant made while the account is unclaimed, writes an audit row.
- **Account creation is refused until outbound email is configured.** The only exception is the first account, created at install by `qcms:create-admin`.
- **Dependency: outbound email.** QCMS has no mail transport today. A transport, its configuration, the message template, delivery-failure handling and resend are v1 deliverables. The choice of mail dependency is undecided (section 16).
- Every emailed sign-in link in this section, for creation, reactivation or after a reset, is single-use and expires after 72 hours.

### Directory visibility

- Workspace administrators add a person by exact email address only.
- Adding an address that is unknown, disabled or unclaimed gets one generic answer, the same for all three. For a Workspace administrator that answer is a refusal: nobody is added.
- Browse and search of the account directory is for Site administrators only.

### Credential and factor reset

- A Site administrator may reset an account's password or second factor from the Accounts screen.
- In the same transaction, all of the account's sessions are revoked.
- The account's memberships of groups carrying a response role are suspended until a Workspace administrator of that workspace, or a Site administrator, re-confirms each one. Other memberships are unaffected.
- Nobody re-confirms their own suspended membership, a Workspace administrator or Site administrator included.
- The Workspace administrator role is a membership flag, not a group, and is not suspended by a reset or a reactivation.
- Default: where an active, claimed administrator exists other than both the person who performed the reset or reactivation and the subject, the re-confirmation comes from such an administrator, never from the person who performed it. Where no such administrator exists, including when the only other administrator is disabled or unclaimed, the person who performed the reset may re-confirm, and the audit row records that they did; the user guide says so.
- One site-audit row is written and mirrored to every affected workspace's audit.
- Default: the person signs in again through an emailed single-use link, then sets a new password after a password reset, or enrols a new second factor after a factor reset.

### Disable

- One act, **Disable account**, by a Site administrator. It succeeds at once and ends every session.
- The last active, claimed Site administrator cannot be disabled.
- Disabling an account removes its Site administrator role, so a reactivation never restores it.
- The confirmation shows what the person holds across all workspaces.
- If the person is the last Workspace administrator of any workspace, the confirmation lists those workspaces and the disable still proceeds.
- Disable keeps memberships. Workspace administrators cannot disable an account; they Revoke the person from their own workspace's groups.
- Disabling an account that is a Site administrator carries the guards of section 8: step-up authentication, and the approval of a Site administrator other than the requester and the target where one exists.
- Accounts are never deleted. Disable is the only way to end an account, so audit history keeps its names.

### Reactivation

- The person sets a new password and re-enrols a second factor through an emailed link.
- Memberships of groups carrying a response role stay suspended until a Workspace administrator of that workspace, or a Site administrator, re-confirms each one. Other memberships return at once.
- The reset rules above apply here too: nobody re-confirms their own membership, the Workspace administrator role is not suspended, and the default on who re-confirms applies, with the person who performed the reactivation in place of the person who performed the reset.
- A reactivated account is not a Site administrator, even if it was one before it was disabled.

### Sessions

- The disabled flag is checked on every request.
- Sessions are deleted in the same transaction as a disable or a reset.
- A running export stops when its account is disabled.
- A pending assistant confirmation from a disabled account is refused.

## 8. Site administrators

- Accounts do not default to Site administrator. The first account, created by `qcms:create-admin`, is one. This is a prerequisite for every other rule in this section: today every account defaults to the claim (the `role` additional field in `apps/api/src/features/auth/instance.ts`).
- Promotion and demotion of a Site administrator, and disabling an account that is a Site administrator, are in-app acts with three guards:
  - step-up authentication, password and second factor, by the acting Site administrator;
  - approval by a second Site administrator where more than one exists, never the target, with the two-administrator case below;
  - an audit row in a table the application role cannot update or delete.
- **Only active, claimed Site administrators count**: for whether more than one exists, for approving, and for the last active Site administrator.
- An unclaimed account cannot be promoted to Site administrator.
- Disabling an account removes its Site administrator role (section 7).
- Suspending a Site administrator is not a separate act. It is Disable account (section 7) with these guards.
- These acts use an approval request at site level: request, approve, reject, expire. A pending request expires after 7 days and can then no longer be approved.
- The requester never approves their own request, and the target of a demotion or a disable never counts as the approver.
- With exactly two Site administrators, step-up authentication alone suffices for one to demote or disable the other, and the audit row records it.
- Default: with exactly one Site administrator, step-up alone suffices to promote a second.
- The last active Site administrator can never be disabled (section 7). Default: the last active Site administrator can never be demoted in the app.
- The Site administrator role does not count toward any workspace's last-administrator guard.
- **Break-glass:** the command-line tools `qcms:create-admin` and `qcms:reset-2fa` remain, as the recovery path when no Site administrator can sign in. The in-app acts do not replace them, and this document does not change what they do.

## 9. Workspaces

- **Creation:** only a Site administrator creates a workspace. They name its first Workspace administrator by address, defaulting to themself; the named account must exist and be claimed, or the creation is refused. The four starter groups are created in the same act.
- **Rename:** the name only. The slug never changes.
- **Archive:** a Workspace administrator or a Site administrator, confirmed by typing the workspace name.
  - Refused while the workspace owns any form, closed and never-published ones included, with the reason inline.
  - Refused while the workspace is the shared question library.
  - There is no unarchive.
- **Move form:** a screen on the form.
  - Needs Edit forms in both the source and the destination workspace.
  - With second approval off in the source, is performed by, or approved by, a Workspace administrator of the source workspace. A move by anyone else is held as a workspace approval request in the source (section 6) and does not take effect until a Workspace administrator of the source, or a Site administrator, who is not the mover approves it.
  - With second approval on in the source, every move is held as a workspace approval request in the source until a Workspace administrator of the source, or a Site administrator, who is not the mover approves it, even when the mover is a Workspace administrator of the source or a Site administrator.
  - A Site administrator may approve a held move, but never their own.
  - The approval is re-checked when it is applied (section 6).
  - Refused when the destination workspace is archived.
  - The confirmation states that the destination's groups will apply, names who gains and who loses access, and says when the move needs an approver and who can approve it.
  - Responses move with the form.
  - Appearance travels by value (proposed default, section 16): the form's draft and versions keep the appearance they carry, and nothing links the form to a theme of the source. A destination with the appearance lock set takes the form as it is; the lock refuses later appearance edits only, never the move. The confirmation says so.
- **Questions** do not move between workspaces. The built route `POST /admin/questions/{id}/workspace` is removed by the foundation task. The shared question library covers reuse across workspaces.
- **Shared question library:** at most one workspace is marked shared; a Site administrator marks or unmarks it. Its screen is a Site administrator rail row at two or more workspaces and hidden at one; question lists show a shared tag.
  - Marking or unmarking writes a site audit row, mirrored to that workspace's audit.
  - The confirmation states who will be able to see its questions: every Edit forms holder in every workspace.
- **Workspace list:** every caller sees only the workspaces they hold something in; a Site administrator sees all. This ships first, with the workspace quick wins.
- **Workspace themes:** a workspace holds named themes (colour tokens, face, corners, an optional logo, the source host of a derive). An Edit forms holder derives one from a website (SEC-18) and saves or changes one; applying a theme to a form is a draft edit.
  - The **appearance lock** is a workspace setting set or cleared by a Workspace administrator or a Site administrator. While it is set, the draft save path refuses any change to a form's appearance; the refusal is the API's, never only the assistant's.
  - The **logo route** serves a theme's logo without a session, with a fixed content type, `X-Content-Type-Options: nosniff` and from the same origin, so SEC-9's `img-src` holds. Only a raster logo (PNG, JPEG, WebP) stored on a workspace theme is ever served; SVG is refused at upload.

## 10. Guards and invariants

- **Last Workspace administrator:** removing or demoting the last active, claimed Workspace administrator of a workspace is refused for every actor, a Site administrator included. The Site administrator role never satisfies the guard.
- **Disable is the exception:** disabling an account always proceeds (section 7), even when it leaves a workspace with no active Workspace administrator.
- **Serialised membership writes:** every membership write in a workspace takes a per-workspace lock, so concurrent changes cannot jointly remove the last administrator.
- **Per-request state:** the disabled flag and every grant are read on each request. No cache may make a revoke or a disable take effect later.
- **One evaluator:** every assistant read, tool offer and proposed step is decided by the same policy evaluator as the screen act, under the user's own session (SEC-17). A suspended membership, a disabled account and a pending approval are rechecked on every draft edit request and at Confirm, because draft edits carry no card (agent-builder Q14).
- **Groups stay inside their workspace:** a group grants nothing on another workspace's forms, groups or audit.
- **Revoke always succeeds** except where the last-administrator guard applies. Nothing about form coverage blocks a revoke.
- **A Site administrator is trusted at site level.** A Site administrator who creates a second account and uses it can defeat second approval, and only the audit catches it. This is an accepted limitation: the audit is the check on what a Site administrator does.

## 11. Audit

Two append-only logs. For both, the application role holds `INSERT` and `SELECT` only, never `UPDATE` or `DELETE`. There is no auditor role.

| Log             | Holds                                                                          | Read by                                                        |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Workspace audit | Response reads, exports and erasures; workspace access acts; assistant actions | That workspace's Workspace administrators; Site administrators |
| Site audit      | Account and Site administrator acts; shared question library marking           | Site administrators                                            |

- A site-level act that affects a workspace is mirrored into that workspace's audit.
- Every one of these acts writes a row:
  - **Accounts:** create, disable, reactivate, credential or factor reset, any grant while unclaimed.
  - **Site administrators:** promote, demote, disable; approval request created, approved, rejected, expired.
  - **Workspace administrators:** appoint, remove.
  - **Access groups:** create, rename, delete, change of roles or environments, member added, member removed, re-confirmation of a suspended membership.
  - **Workspaces:** create, rename, archive, form moved in or out, second-approval switch changed, appearance lock set or cleared (one `setting` row), marked or unmarked as the shared question library.
  - **Workspace themes:** each theme derive fetch, one row (SEC-18).
  - **Workspace approval requests** (turning second approval off, self-grant, Move form): created, approved, rejected, expired.
  - **Pending draft publish to `prod`** on a site whose only environment is `prod` (approved on the form, not a workspace approval request): requested, approved, rejected, expired.
- The stored kinds for these rows, beyond the workspace audit's six existing kinds, are settled in the foundation task (section 16).
  - **Existing rows, unchanged:** response read, export and erasure; `prod` endpoint propose, confirm and withdraw; release-workflow change.

## 12. Navigation and screens

The shipped navigation stands: the top bar is app navigation with the workspace and environment choosers, and the left rail is on every screen. Access screens live in three homes:

| Home                   | Screens                                                                                                          | Who                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Workspace area         | Members, Access groups, Settings, Audit (with Requests), Archive                                                 | Workspace administrators, Site administrators |
| Site configuration     | Accounts, Site administrators, Approval requests, Site audit, Workspaces, New workspace, Shared question library | Site administrators                           |
| Account menu (top bar) | My account, My access                                                                                            | Everyone                                      |

- Forms, Operations and Responses screens change only in what they show or disable for the person's roles, with a short reason where an action is unavailable.
- There is no form-level access screen and no access step in form creation.
- The design canvas (https://claude.ai/artifact/S1Mt2WFT52Q9vKuqNPARD4) is the UI plan. No admin UI task starts until its screens are on the canvas and the Code Owner has seen them.

Routes are under `apps/admin/app/(shell)/`. Artboards are boards on the design canvas, named without the `.dc.html` suffix. The canvas boards have not yet been reviewed by the Code Owner, and no admin UI task starts until they have.

| Flow                                                                                            | Who                                                                            | Route or location                                                | Design artboard                                      | Status       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------- | ------------ |
| My account                                                                                      | Everyone                                                                       | `settings/`                                                      | Account-Menu, Phone-E                                | Partly built |
| My access                                                                                       | Everyone                                                                       | `me/access/`                                                     | Account-Menu, Phone-E                                | Partly built |
| No access yet home                                                                              | Account with no access                                                         | new                                                              | First-Signin, Patterns-B, Phone-E                    | Not built    |
| Claim an account: set password, enrol second factor                                             | Holder of a sign-in link                                                       | new (opened from the emailed link)                               | First-Signin                                         | Not built    |
| Accounts list                                                                                   | Site administrator                                                             | new (Site configuration)                                         | Accounts, Phone-E                                    | Not built    |
| Create account                                                                                  | Site administrator                                                             | new (Site configuration)                                         | Accounts                                             | Not built    |
| Account detail: holdings, disable, reset                                                        | Site administrator                                                             | new (Site configuration)                                         | Account-Manage, Phone-E                              | Not built    |
| Reactivate account                                                                              | Site administrator                                                             | new (on the account detail)                                      | Account-Manage                                       | Not built    |
| Step-up dialog: password and second factor                                                      | Site administrator                                                             | new (dialog on Site administrators and account detail)           | Site-Admins                                          | Not built    |
| Site administrators                                                                             | Site administrator                                                             | new (Site configuration)                                         | Site-Admins                                          | Not built    |
| Approval requests, site and workspace                                                           | Site administrator                                                             | new (Site configuration)                                         | Approval-Requests, Phone-E                           | Not built    |
| Site audit                                                                                      | Site administrator                                                             | new (Site configuration)                                         | Site-Audit                                           | Not built    |
| Workspaces list                                                                                 | Site administrator                                                             | `workspaces/all/`                                                | Screens-E, Phone-C                                   | Partly built |
| New workspace                                                                                   | Site administrator                                                             | new (Site configuration)                                         | Screens-E, Patterns-B, Phone-C                       | Not built    |
| Shared question library: mark or unmark, with a confirmation stating who will see its questions | Site administrator                                                             | new (Site configuration)                                         | Screens-F, Phone-C                                   | Not built    |
| Members                                                                                         | Workspace administrator, Site administrator                                    | `workspaces/[workspaceId]/members/`                              | Members, Members-Three, Screens-A, Phone-A           | Partly built |
| A person's access in the workspace                                                              | Workspace administrator, Site administrator                                    | new (side sheet on Members)                                      | Members, Patterns-A, Phone-D                         | Not built    |
| Appoint or remove a Workspace administrator                                                     | Workspace administrator, Site administrator                                    | new (side sheet on Members)                                      | Members, Patterns-A                                  | Not built    |
| Re-confirm a suspended membership                                                               | Workspace administrator, Site administrator; never the subject                 | new (side sheet on Members)                                      | People-Person, Phone-D                               | Not built    |
| Access groups                                                                                   | Workspace administrator, Site administrator                                    | `workspaces/[workspaceId]/access-groups/`                        | Screens-B, Phone-A                                   | Partly built |
| New access group                                                                                | Workspace administrator, Site administrator                                    | new (level-2 rail row under Access groups)                       | Screens-C, NewGroup-Closed, FormSelect-Card, Phone-B | Partly built |
| Access group detail                                                                             | Workspace administrator, Site administrator                                    | new                                                              | Screens-B                                            | Not built    |
| Workspace settings: rename, second approval, warning when nobody else could approve             | Workspace administrator, Site administrator                                    | `workspaces/[workspaceId]/settings/`                             | Screens-C, Phone-B                                   | Partly built |
| Workspace themes: list, derive, save; appearance lock                                           | Edit forms (themes); Workspace administrator, Site administrator (lock)        | `workspaces/[workspaceId]/settings/`                             | Agent builder canvas, to be confirmed                | Not built    |
| Workspace audit                                                                                 | Workspace administrator, Site administrator                                    | `workspaces/[workspaceId]/audit/`, `assistant-actions/`          | Screens-D, Phone-B                                   | Partly built |
| Workspace requests                                                                              | Workspace administrator, Site administrator                                    | new (Requests row on the workspace Audit screen)                 | Screens-D                                            | Not built    |
| Archive workspace                                                                               | Workspace administrator, Site administrator                                    | new (rail row at two or more workspaces)                         | Screens-F, Phone-C                                   | Not built    |
| Forms list                                                                                      | Form roles                                                                     | `forms/`                                                         | Forms-Unavailable                                    | Partly built |
| Create form                                                                                     | Edit forms                                                                     | `forms/new/`                                                     | to be confirmed on the canvas                        | Built        |
| Edit form                                                                                       | Edit forms                                                                     | `forms/[formId]/`                                                | Forms-Unavailable                                    | Built        |
| Publish to an environment                                                                       | Publish forms, and Edit forms for a draft                                      | `forms/[formId]/publish/`                                        | Form-Publish, Phone-F                                | Partly built |
| Move form                                                                                       | Edit forms in both workspaces; an approver per section 9 when the move is held | new (rail row on the form)                                       | Form-Move, Phone-F                                   | Not built    |
| Availability, links, webhooks                                                                   | Publish forms                                                                  | `operations/forms/[formId]/availability/`, `links/`, `webhooks/` | Operations-Unavailable                               | Partly built |
| Responses and export                                                                            | View responses                                                                 | `operations/forms/[formId]/responses/`                           | Operations-Unavailable, Phone-F                      | Partly built |
| Erase responses                                                                                 | Erase responses                                                                | `operations/forms/[formId]/erase/`                               | Operations-Unavailable                               | Partly built |

## 13. Shared UX patterns

Each is one reusable design.

1. **Access explanation:** rows of action by environment, each naming the granting group or "no group grants this". Used on My access and on a person's page.
2. **Preview before confirming:** who gains or loses what, in which environments, and whether approval is needed and from whom. The confirm button names the act. Move form says when the move needs an approver and who can approve it, and that the form's appearance moves with it as it is; marking the shared question library states who will be able to see its questions.
3. **Confirmation levels:** plain confirm for reversible changes; typed name for irreversible ones (erase responses, archive workspace).
4. **Last-administrator controls:** Remove or Demote is disabled with the reason and a link to appoint someone else.
5. **No access yet home:** for an account with no access; names the administrator and links to My access.
6. **New workspace:** opens with the four starter groups and a short checklist.
7. **One-person site:** the first account is Site administrator, Workspace administrator and a member of all four starter groups.
8. **No group covers this notice** in Access groups: "Environment X: no group covers it yet." The same notice names a role or environment left uncovered after a group is changed or deleted.
9. **Scale:** search and rail filters (role, environment, status) on people, groups and accounts; results under 300 ms at 1,000 accounts.
10. **Accessibility:** full checkbox labels, announced errors, keyboard reachable, per `docs/COMPONENT_GUIDELINES.md`.
11. **Nobody else could approve warning** on Settings: shown while second approval is on and nobody else could approve, on the same test as turning the rule on (section 6).

## 14. Acceptance criteria

Each criterion is tested against the real policy code, service or route as its task lands.

### Roles and environments

1. Every role by act by environment in the section 3 matrix is allowed where marked and refused elsewhere, including every blank cell.
2. A View forms holder is refused every write and every response read.
3. A View forms holder sees an endpoint URL with its query string masked; Edit forms and Publish forms holders see the whole URL.
4. An Edit forms holder without Publish forms cannot freeze a version or publish anywhere.
5. Publishing a draft to `test` succeeds for a person holding Edit forms and Publish forms for `test`, through one group or two.
6. Publishing a version to `prod` succeeds for a Publish forms holder for `prod` and is refused for one holding Publish forms for `test` only.
7. On a site with a non-prod environment, publishing a draft straight to `prod` is refused, and no workspace setting or release-workflow configuration makes it succeed.
8. On a site whose only environment is `prod`, with second approval off, publishing a draft to `prod` succeeds at once for a person holding Edit forms and Publish forms for `prod`.
9. Open, close, link and webhook acts in an environment are refused for a person whose Publish forms groups do not name it.
10. View responses and Erase responses are refused in an environment the person's groups do not name.
11. An Erase responses holder cannot read or export a response.
12. A group holding only View forms or Edit forms is saved with no environment set and grants the same in every environment.
13. Saving a group that carries Publish forms, View responses or Erase responses with no environment is refused, on a site whose only environment is `prod` as on any other.
14. A newly added environment is covered by no group; a person in every existing group is refused every environment-scoped act in it.
15. Editing and saving a group never adds an environment the administrator did not select.
16. Creating or moving a form changes no group.
17. A new form is reachable at once by every holder of the matching role in its workspace.
18. Publishing an earlier version to an environment (rollback) succeeds for a Publish forms holder for that environment and freezes nothing.

### Administrators

19. A Workspace administrator with no group membership is refused every form, publish and response act in their workspace.
20. A Site administrator with no group membership is refused every response read, export and erasure in every workspace.
21. A person who is neither a Workspace administrator nor a Site administrator is refused each administrative act: Grant, Revoke, group create, change and delete, Workspace administrator appoint and remove, settings, audit read, archive.
22. A person who is not a Site administrator is refused each site act: account create, disable, reactivate, reset, directory browse, Site administrator promote and demote, approval decisions, site audit read, workspace create, shared library marking and unmarking.
23. A Workspace administrator of workspace A is refused every administrative act on workspace B's people, groups, settings and audit.
24. A member of workspace A is refused every form, version and response of workspace B, by id as well as by list.
25. A group id from workspace B used in a Grant in workspace A is refused.
26. The workspace list returns only workspaces the caller holds something in; a Site administrator gets all.

### Second approval

27. With the rule on, publishing a version to `prod` is refused for the account that froze it and succeeds for a different Publish forms holder for `prod`, who is recorded as the approver.
28. With the rule on, a `prod` endpoint change is held until a different Publish forms holder for `prod` confirms it; the proposer's own confirm is refused.
29. With the rule on, links and open or close in `prod` need no approval.
30. With the rule on, the account that froze a version publishes it to a non-prod environment without approval.
31. On a site whose only environment is `prod`, with the rule on, publishing a draft to `prod` creates an approval request and freezes and publishes nothing. Only when a different holder of Publish forms for `prod` approves it is the draft frozen as the next version and made live in `prod`. The requester's own approval, and an approval by someone without Publish forms for `prod`, are refused. On approval the requester is recorded as the person who froze the version and the approver as the approver, and a later publish of that version to `prod` by the requester is refused.
32. With the rule on, a self-grant into a group carrying a response role is not applied until approved by a different Workspace administrator or a Site administrator who is not the requester.
33. With the rule on, an administrator who is in a group and edits it to add View responses, or to add an environment to its response role, is held for approval; the same edit by an administrator who is not in the group applies at once.
34. With the rule on, an administrator who joins a group with no response role and then adds a response role to it is held for approval at that edit.
35. Approving a pending self-grant grants the roles and environments the group had when the request was made, not a role or environment added to the group afterwards.
36. With the rule on, turning it off is not applied until approved by a different Workspace administrator or a Site administrator who is not the requester.
37. In every approval, approver equals requester is refused.
38. Turning the rule on is refused where there is no second administrator or no second holder of Publish forms for `prod`.
39. Turning the rule on is refused where the only other administrator, or the only other holder of Publish forms for `prod`, is unclaimed or disabled.
40. An unclaimed or disabled account cannot approve a `prod` publish, a `prod` endpoint change or a workspace request.
41. Turning the rule on succeeds in a workspace with one Workspace administrator when a Site administrator who is not the requester exists and a second holder of Publish forms for `prod` exists.
42. A Site administrator who is the requester cannot approve their own workspace request.
43. A Site administrator who is not the requester can approve a workspace request in a workspace with one Workspace administrator.
44. With the rule on, Settings shows the nobody-else-could-approve warning once the only other administrator, or the only other holder of Publish forms for `prod`, is disabled, and does not show it while another approver exists.
45. A pending workspace request appears in the Requests row of that workspace's Audit screen and under Approval requests in Site configuration.
46. A workspace request expires after 7 days and can then no longer be approved.
47. A rejected workspace or site request is not applied.
48. Approving a held request is refused, and nothing is applied, when the requester no longer holds what the act needs: a Move form whose mover has lost Edit forms in either workspace, or whose destination was archived, after the request; a draft publish whose requester has lost Edit forms or Publish forms for `prod`; a self-grant or a switch-off whose requester is no longer a Workspace administrator of that workspace or a Site administrator.
49. With the rule off, a self-grant of a response role succeeds and writes an audit row.

### Accounts

50. Account creation emails a single-use, expiring link to the address; no response or screen shows the link or a password to the administrator.
51. Account creation is refused while outbound email is not configured; the first account, created by `qcms:create-admin`, is not.
52. A used link is refused, and a link is refused 72 hours after it was issued.
53. First sign-in through the link forces password set and second-factor enrolment before any other act.
54. An unclaimed account cannot act, does not count toward the last-administrator guard and cannot be an approver.
55. A grant to an unclaimed account writes an audit row.
56. A Workspace administrator adding an unknown, a disabled or an unclaimed address gets one identical refusal, and nobody is added.
57. A Workspace administrator cannot browse or search the account directory.
58. A credential or factor reset revokes every session of the account in the same transaction.
59. After a reset, the account's response-role memberships are suspended until re-confirmed per workspace; other memberships still work.
60. Under the default, the administrator who performed a reset or a reactivation cannot re-confirm where an active, claimed administrator other than them and the subject exists, a Site administrator included.
61. Under the default, where the only administrators are the person who performed the reset or reactivation and the subject, or where the only other administrator is disabled or unclaimed, the person who performed it can re-confirm, and the audit row records that they did.
62. A Site administrator who did not perform the reset can re-confirm a suspended membership in any workspace.
63. The subject of a suspended membership cannot re-confirm it, as a Workspace administrator or as a Site administrator, whether or not another administrator exists.
64. After a reset or a reactivation, a Workspace administrator still holds the Workspace administrator role in that workspace.
65. After a reset, the person can sign in again only through an emailed single-use link, and must set a new password after a password reset, or enrol a second factor after a factor reset, before any other act; a factor-only reset does not force a new password (default).
66. Disable ends every session at once; the next request on an old session is refused.
67. Disable stops a running export and refuses a pending assistant confirmation.
68. Disable keeps memberships; reactivation returns non-response memberships at once and keeps response-role memberships suspended until re-confirmed.
69. Reactivation requires a new password and second-factor re-enrolment through an emailed link.
70. Disabling the last active, claimed Site administrator is refused.
71. Disabling an account that is a Site administrator removes the role; after reactivation the account is not a Site administrator.
72. Disabling the last Workspace administrator of a workspace proceeds, and the confirmation lists that workspace.
73. A Workspace administrator cannot disable an account.
74. No route or screen deletes an account.

### Site administrators

75. A new account is not a Site administrator.
76. Promotion, demotion and disabling a Site administrator require step-up authentication by the actor.
77. With two or more active, claimed Site administrators, promotion takes effect only after a second Site administrator approves; the requester's own approval is refused.
78. With three or more active, claimed Site administrators, demotion and disabling a Site administrator take effect only after a Site administrator other than the requester and the target approves; the target's approval is refused.
79. With exactly two active, claimed Site administrators, the target cannot approve its own demotion or disable, and step-up alone suffices; the audit row records the step-up.
80. Promoting an unclaimed account to Site administrator is refused.
81. An unclaimed or disabled account does not count as a second Site administrator and cannot approve a site request.
82. With one Site administrator, step-up alone promotes a second (default).
83. Demoting the last active Site administrator is refused (default).
84. A pending site request expires after 7 days and can then no longer be approved.
85. `qcms:create-admin` and `qcms:reset-2fa` still restore access when no Site administrator can sign in.

### Guards

86. Removing or demoting the last active, claimed Workspace administrator is refused for every actor, a Site administrator included.
87. A disabled or unclaimed Workspace administrator, or a Site administrator who is not a Workspace administrator of that workspace, does not satisfy the last-administrator guard.
88. Two concurrent removals that together would remove the last Workspace administrator leave at least one; one of them is refused.
89. A Revoke takes effect on the next request with no cache delay.
90. Every assistant tool offer and every proposed step for a user matches what that user's own screen acts allow.
91. At assistant Confirm, and on every assistant draft edit request (draft edits carry no card), a step is refused when the account is disabled or the membership it needs was suspended after the step was proposed, and a step whose act needs an approver is not applied until approved.

### Workspaces

92. Only a Site administrator creates a workspace; it is created with the four starter groups and the named first Workspace administrator.
93. Creating a workspace is refused when the named first Workspace administrator is not an existing, claimed account.
94. On a site with `dev`, `test` and `prod`, a new workspace's Authors covers `dev` and `test`, and Publishers, Response viewers and Response erasers cover `prod`.
95. On a site whose only environment is `prod`, a new workspace's Authors carries Edit forms only, with no environment set, and holds neither Publish forms nor View responses; Publishers, Response viewers and Response erasers cover `prod`.
96. A starter group can be renamed and deleted; after Response erasers is deleted, Access groups shows that no group covers Erase responses in `prod`.
97. Rename changes the name and never the slug.
98. Archive is refused while any form remains or while the workspace is the shared library; there is no unarchive.
99. Move form is refused unless the actor holds Edit forms in both workspaces; after it, the destination's groups apply and the source's do not, and the form's responses move with it.
100.  Move form to an archived workspace is refused.
101.  The Move form confirmation names who gains and who loses access before it is confirmed.
102.  With second approval off in the source, a Move form by a person with Edit forms in both workspaces who is not a Workspace administrator of the source is held and not applied until a Workspace administrator of the source or a Site administrator approves it, and so is a Move form by a Site administrator who is not a Workspace administrator of the source; the mover's own approval, and an approval by a Workspace administrator of the destination only, are refused.
103.  With second approval off in the source, a Move form by a Workspace administrator of the source who holds Edit forms in both workspaces applies without approval.
104.  With second approval on in the source, a Move form by a Workspace administrator of the source who holds Edit forms in both workspaces is held and not applied until a different Workspace administrator of the source or a Site administrator approves it; the mover's own approval is refused.
105.  With second approval on in the source, a Move form by a Site administrator who holds Edit forms in both workspaces is held, and that Site administrator's own approval is refused; a Workspace administrator of the source or another Site administrator can approve it.
106.  A Site administrator who is not the mover can approve a held Move form, in a workspace where they are not a Workspace administrator.
107.  No route moves a question between workspaces; `POST /admin/questions/{id}/workspace` no longer exists.
108.  An Edit forms holder in another workspace can pin a shared library question and is refused editing it.
109.  Marking or unmarking a workspace as the shared question library writes a site audit row and a mirrored row in that workspace's audit; the confirmation states that every Edit forms holder in every workspace will be able to see its questions.
110.  On a one-person site, the first account is Site administrator, Workspace administrator and a member of all four starter groups.

### Audit

111. Each act listed in section 11 writes exactly one row in its log, and a site act affecting a workspace also writes a mirrored row there.
112. The application role cannot update or delete a row in either log.
113. A Workspace administrator cannot read the site audit or another workspace's audit.

### Scale and accessibility

114. Search over people, groups and accounts returns in under 300 ms at 1,000 accounts.
115. New access screens meet `docs/COMPONENT_GUIDELINES.md`.

### Held publish

116. On a site whose only environment is `prod`, with the rule on, approving a held draft publish applies the draft content as it was when requested and shows the approver that content. If the draft changed after the request, the approval is refused and nothing is frozen or published; a new request is needed.
117. On a site whose only environment is `prod`, with the rule on, a change to the draft's appearance alone after a draft publish was requested makes the approval refused, as a change to its questions does.

### Workspace themes

118. Saving or changing a workspace theme succeeds for an Edit forms holder in that workspace and is refused for a View forms holder, for an Edit forms holder of another workspace, and for a Workspace administrator or Site administrator without Edit forms.
119. Deriving a workspace theme succeeds for an Edit forms holder in that workspace and is refused for everyone else, each fetch writing one audit row.
120. Setting or clearing the appearance lock succeeds for a Workspace administrator of that workspace and for a Site administrator, is refused for every other actor, an Edit forms holder included, needs no approver with second approval on, and writes exactly one `setting` row in the workspace audit.
121. While the appearance lock is set, a draft save that changes appearance is refused by the API for every actor and for the assistant, and a draft save that changes no appearance succeeds.
122. The logo route serves only a raster logo stored on a workspace theme, without a session, with a fixed content type and `X-Content-Type-Options: nosniff`; an SVG upload is refused.
123. A Move form carries the form's appearance by value: after the move the draft and versions keep it, a lock set in the destination refuses later appearance edits and not the move, and the Move form confirmation says so.

## 15. Decision records this document supersedes or amends

Each record below, except the built-task records, now links here for workspace access. Where earlier text in any of them still differs, this document holds.

| Record                       | File                                                                                                                                                                                             | What this document replaced                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-41                       | `docs/adr/core.md`                                                                                                                                                                               | Six roles, environment and form scopes, `all`, the one-role group name grammar, `forms.owner`, the installation claim, the seed setting and the first-run seed (sections 2 to 8), the Note that a question may move workspaces, and the archive Note's reassigning of questions before an archive (section 9). The workspace and the enforcement table stand; the mechanism and the notes on what tasks 068 to 070 built stay as built, with lines pointing here. |
| SEC-1                        | `docs/SECURITY_DESIGN.md` §2.1                                                                                                                                                                   | Account creation only by the CLI; session invalidation on disable and reset; the in-app reset beside `qcms:reset-2fa` (section 7). The as-built text stands, with a line pointing here.                                                                                                                                                                                                                                                                           |
| SEC-3                        | `docs/SECURITY_DESIGN.md` §3.1, §3.2                                                                                                                                                             | The role model and the installation claim (sections 3 and 8). §3.1 and the §3.2 role table stay as built, marked so, because `matrix-coverage.e2e.ts` pins the policy code to the table.                                                                                                                                                                                                                                                                          |
| SEC-15                       | `docs/SECURITY_DESIGN.md` §8b                                                                                                                                                                    | Readers, grant detail, the seed-setting row and the self-grant rule (sections 6 and 11). The as-built text stands, with a line pointing here.                                                                                                                                                                                                                                                                                                                     |
| SEC-17                       | `docs/SECURITY_DESIGN.md` §8d                                                                                                                                                                    | Guarantee 3's role families, which section 10 restates; guarantee 3 points here.                                                                                                                                                                                                                                                                                                                                                                                  |
| Section 6 rows and matrix    | `plan/environments-and-workspaces.md`                                                                                                                                                            | Q13, Q14, Q15, F5, Q25, Q27 to Q30, Q32 to Q39, F10, F17, the permissions matrix, the access-group names, Q51, Q56 to Q58, Q61, Q69, Q73, Q79 and Q85 point here. Q4, Q64 to Q66, Q70 and Q86 stand.                                                                                                                                                                                                                                                              |
| Section 7 rulings            | `plan/workspaces-review.md`                                                                                                                                                                      | R3, R8, R10 to R14, R16, R20 and R21 corrected; R17 withdrawn.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Design brief                 | `plan/design-brief-workspaces.md`                                                                                                                                                                | Roles, the access map, accounts and the Move form screen.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Operator and reference docs  | `docs/webhooks.md`, `docs/operations.md`, `docs/auth-swap.md`, `docs/environment-capabilities.md`                                                                                                | Endpoint acts, masking, audit readers and the capability role table. They keep the role names the API enforces today, with a line pointing here.                                                                                                                                                                                                                                                                                                                  |
| ADR-40                       | `docs/adr/core.md`                                                                                                                                                                               | The environment drop rule names an access group's environment set rather than its scope; the rule is unchanged.                                                                                                                                                                                                                                                                                                                                                   |
| Built-task records           | `docs/features/068` to `070`, the ledger in `docs/features/README.md`                                                                                                                            | Nothing: they describe the earlier model as built and are left as history.                                                                                                                                                                                                                                                                                                                                                                                        |
| Handovers and working papers | `plan/environment-navigation-implementation.md`, `plan/environment-phase1-decisions.md`, `plan/environment-ux-recommendation.md`, `plan/agent-everywhere.md`, `plan/form-publishing-workflow.md` | A header line points here; their role tables record the earlier model.                                                                                                                                                                                                                                                                                                                                                                                            |

## 16. Defaults and undecided items

### Defaults open to revision

- After a credential reset or a reactivation, re-confirmation of response memberships comes from an active, claimed administrator other than both the person who did the reset or reactivation and the subject, where one exists; where none exists, the person who did it may re-confirm, and the audit records it.
- With one Site administrator, step-up alone suffices to promote a second.
- The last active Site administrator cannot be demoted.
- Questions keep "Publish" with its current meaning.
- After a credential or factor reset, the person signs in again through an emailed single-use link; a factor-only reset does not force a new password.

### Proposed defaults awaiting a Code Owner ruling

- A Site administrator may set or clear the workspace appearance lock, as for the other workspace settings; agent-builder Q18 names the Workspace administrator only. The act needs no second approval.
- Move form carries the form's appearance by value, and a destination lock refuses later appearance edits only (section 9).
- The re-check on assistant acts runs on every draft edit request as well as at Confirm (section 10, criterion 91), following agent-builder Q14's card-less draft edits.

Request expiry (7 days), the `prod` rule with its exception for a site whose only environment is `prod` (section 5) and the held draft publish applying the draft as requested (section 6) are settled, not defaults. That a Site administrator is trusted at site level is an accepted limitation, stated in section 10, not an open item.

### Undecided

- The choice of mail dependency for outbound email. It needs the Code Owner's runtime dependency approval and is brought by the email task; the proposal is `nodemailer` over SMTP.
- Storage shape of an access group (several roles on one stored group, or one stored group per role) and the fate of the `<environments>.<role>[.<label>]` name grammar. Left to the foundation task and reviewed there.
- Audit kinds for the new acts beyond the workspace audit's six existing kinds (Q79), and the site audit's row shape. Left to the foundation task and reviewed there.
- A workspace's own questions at archive. This document states no rule. As built, questions do not block an archive and stay with the archived workspace, taking no new pin (ADR-41's archive Notes); the earlier "questions are reassigned first" no longer applies, because questions do not move.

## 17. Out of scope and deferred

- Per-form authorisation of any kind, including form-limited response groups and form-level access screens.
- Data migration, upgrade paths and backward compatibility.
- An auditor role.
- Unarchive.
- A separate approvals queue for publish approvals.
- Emergency suspension as a separate act.
- A coverage engine, a Form creators group, group picking at form creation and an eligible-editor check.
- Second approval outside `prod`, and for links or open and close.
- The seed-new-editors-with-test-responses setting.
- Moving questions between workspaces; the built route is removed (section 9).
- Account deletion is not in v1.
