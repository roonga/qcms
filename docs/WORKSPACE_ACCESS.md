# Workspace access

## 1. Status and authority

- This document is the single source of truth for workspace access in QCMS: accounts, administrators, workspaces, access groups, roles, environments, second approval, audit and the screens that manage them.
- Decision records (ADR-41, SEC-1, SEC-3, SEC-15, SEC-17, `plan/environments-and-workspaces.md`, `plan/workspaces-review.md`) link here for anything this document covers. Where one of them disagrees with this document, this document holds; section 15 lists every passage to replace.
- QCMS is green field for this model: schema changes take the new shape directly, with no data migration, upgrade path or backward compatibility.
- Tests are written against the real policy code as each task lands. Section 14 lists the cases they must cover.

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

## 2. Glossary

| Term                    | Meaning                                                                                                          | Replaces                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Account                 | One person's sign-in identity on the site.                                                                       | user                                                                   |
| Unclaimed account       | An account whose emailed sign-in link has not yet been used.                                                     | provisional account                                                    |
| Site administrator      | Administers the whole site: accounts, workspaces, Site administrators, site settings. Reads no data by the role. | installation admin, Installation administrator, installation claim     |
| Workspace administrator | Administers one workspace: its people, access groups, settings, audit and archive. Reads no data by the role.    | Workspace owner, `forms.owner`                                         |
| Workspace               | The only access zone. Owns forms and questions.                                                                  |                                                                        |
| Environment             | A named data plane such as `test` or `prod`.                                                                     |                                                                        |
| Access group            | A set of roles plus one environment set, in one workspace, with the people in it.                                | team                                                                   |
| People in this group    | The accounts that are members of an access group.                                                                | holders                                                                |
| View forms              | Role: read forms, questions, versions and publish history.                                                       | Form viewer, `forms.viewer`                                            |
| Edit forms              | Role: draft and edit forms and questions, preview.                                                               | Form editor, `forms.editor`                                            |
| Publish forms           | Role: publish to an environment, open and close, links, webhooks.                                                | Release approver, `forms.approver`, Release forms, Release and operate |
| View responses          | Role: view and export responses.                                                                                 | Response viewer, `responses.viewer`, handler                           |
| Erase responses         | Role: erase responses without reading them.                                                                      | Response eraser, `responses.eraser`, eraser                            |
| Publish                 | Make a version live in an environment, freezing the draft first when publishing a draft.                         | release, publish-and-release (for forms)                               |
| Version                 | A frozen, numbered form definition. The same version moves from `test` to `prod`.                                | published version                                                      |
| Second approval         | Workspace setting requiring a second person for named `prod` acts.                                               | two-person rule, approver-not-author, `requireSecondApprover`          |
| Approver                | The second person under second approval.                                                                         | second approver                                                        |
| Grant, Revoke           | Add a person to, or remove them from, an access group.                                                           | Give access, Remove access                                             |
| Authors                 | Starter group: Edit forms, Publish forms, View responses; `test`.                                                | Builders, Form editors                                                 |
| Publishers              | Starter group: Publish forms; `prod`.                                                                            | Releasers, Form publishers                                             |
| Response viewers        | Starter group: View responses; `prod`.                                                                           | Response readers                                                       |
| Response erasers        | Starter group: Erase responses; `prod`.                                                                          |                                                                        |

## 3. The model

- **Accounts** are site-wide. An account holds nothing by default.
- **Site administrator** is an explicit role on an account. It administers every workspace as a Workspace administrator would, plus the site-level acts in the matrix.
- **The workspace is the only access zone.** There is no per-form authorisation anywhere, response roles included. A site that wants separate zones creates workspaces.
- **Workspace administrator** is a direct flag on a person's membership of one workspace.
- **An access group** belongs to one workspace and carries a set of roles and one environment set. People in the group hold every role in it, in every environment in the set, for every form in the workspace.
- **Roles are additive across groups.** A person in two groups holds the union.
- **Environments are named explicitly** on each group. There is no "all environments" value. A newly added environment is covered by no group until an administrator adds it to a group.
- **View forms and Edit forms ignore the environment set.** A group holding only those roles shows no environment picker.
- **Publish forms, View responses and Erase responses apply only in the group's environments.**
- **Administrators administer and hold no form or response role** unless they are also in a group that grants one.
- **The production split stays visible**: a person who builds in `test` and publishes to `prod` is in two groups.
- **Form creation and form lifecycle change no group.** Creating a form picks no group; the workspace's groups apply to it at once.

### Role by act

`yes` means always; `env` means only in an environment in the group's environment set; blank means refused. The Site administrator column applies in every workspace.

| Act                                                                       | View forms   | Edit forms         | Publish forms             | View responses | Erase responses | Workspace administrator | Site administrator |
| ------------------------------------------------------------------------- | ------------ | ------------------ | ------------------------- | -------------- | --------------- | ----------------------- | ------------------ |
| Read forms, questions, versions and publish history                       | yes          | yes                | yes                       |                |                 |                         |                    |
| Read link and endpoint configuration                                      | yes (masked) | yes                | yes                       |                |                 |                         |                    |
| Draft and edit forms and questions, pin shared questions, preview         |              | yes                |                           |                |                 |                         |                    |
| Publish a draft to an environment (freezes the next version)              |              | with Publish forms | env, with Edit forms      |                |                 |                         |                    |
| Publish an existing version to an environment                             |              |                    | env                       |                |                 |                         |                    |
| Open or close a form                                                      |              |                    | env                       |                |                 |                         |                    |
| Mint or revoke links                                                      |              |                    | env                       |                |                 |                         |                    |
| Configure webhook endpoints                                               |              |                    | env                       |                |                 |                         |                    |
| Approve a `prod` publish or endpoint change under second approval         |              |                    | `prod`, not the requester |                |                 |                         |                    |
| Discover operational form metadata in an environment                      | yes          | yes                | yes                       | env            | env             |                         |                    |
| Read the release-workflow configuration                                   | yes          | yes                | yes                       |                |                 |                         |                    |
| View and export responses                                                 |              |                    |                           | env            |                 |                         |                    |
| Erase responses                                                           |              |                    |                           |                | env             |                         |                    |
| Move a form to another workspace                                          |              | in both workspaces |                           |                |                 |                         |                    |
| See people and access groups                                              |              |                    |                           |                |                 | yes                     | yes                |
| Grant, Revoke; create, change or delete access groups                     |              |                    |                           |                |                 | yes                     | yes                |
| Appoint or remove a Workspace administrator                               |              |                    |                           |                |                 | yes                     | yes                |
| Re-confirm a suspended response membership                                |              |                    |                           |                |                 | yes                     |                    |
| Workspace settings: rename, second approval                               |              |                    |                           |                |                 | yes                     | yes                |
| Read the workspace audit                                                  |              |                    |                           |                |                 | yes                     | yes                |
| Archive the workspace                                                     |              |                    |                           |                |                 | yes                     | yes                |
| Create a workspace and name its first Workspace administrator             |              |                    |                           |                |                 |                         | yes                |
| Mark the shared question library                                          |              |                    |                           |                |                 |                         | yes                |
| Create, disable, reactivate an account; reset its credentials or factor   |              |                    |                           |                |                 |                         | yes                |
| Browse and search the account directory                                   |              |                    |                           |                |                 |                         | yes                |
| Promote, demote or suspend a Site administrator; decide approval requests |              |                    |                           |                |                 |                         | yes                |
| Read the site audit                                                       |              |                    |                           |                |                 |                         | yes                |
| Release-workflow configuration, environment settings, site-wide queues    |              |                    |                           |                |                 |                         | yes                |
| Read any response by virtue of the administrator role                     |              |                    |                           |                |                 | never                   | never              |

- "Masked" is the endpoint URL with its query string masked, done by the API.
- Every account, administrator or not, manages its own password, second factor, recovery codes and sessions, and reads its own access (My access).
- The shared question library keeps its design: every workspace's Edit forms holders see and pin its questions; only Edit forms holders in the shared workspace edit them.

## 4. Starter groups

Every new workspace is created with four starter groups. They are ordinary groups: renamable, editable and deletable.

| Group            | Roles                                     | Environments |
| ---------------- | ----------------------------------------- | ------------ |
| Authors          | Edit forms, Publish forms, View responses | `test`       |
| Publishers       | Publish forms                             | `prod`       |
| Response viewers | View responses                            | `prod`       |
| Response erasers | Erase responses                           | `prod`       |

- A new workspace's starter groups have no people, except on a one-person site.
- **One-person site**: the first account is Site administrator, Workspace administrator of the first workspace and a member of all four starter groups. Second approval is off.
- There is no Form creators group and no setting that seeds response access for new editors.

## 5. Publishing

- The user-facing step for forms is **Publish to `<environment>`**. "Release" is not part of the forms vocabulary in the UI.
- **Publishing a draft** freezes it as the next numbered version and makes that version live in the chosen environment, in one act. It needs Edit forms and Publish forms for that environment.
- **Publishing an existing version** to another environment makes the same version live there. Nothing is frozen or changed. It needs Publish forms for that environment.
- Edit forms alone cannot freeze a version.
- The data model keeps frozen, numbered versions: the same version goes from `test` to `prod`, history is kept, and rollback is publishing an earlier version. Code identifiers and API paths such as `releases` may keep their names.
- Default: `prod` accepts only a version already published to a non-prod environment. A draft is never published straight to `prod`.
- Default: questions keep "Publish" with its current meaning, freezing a pinnable version with no environment.
- The single Publish step is its own task: the form Publish tab, the release-workflow screens, the assistant publish cards and forms-area copy.

## 6. Second approval

- A per-workspace setting, off by default. It applies in `prod` only.
- **Covered acts in `prod`:** publishing a version, and changing a webhook endpoint. Links and open or close are not covered.
- **Publishing to `prod`:** refused for the account that froze that version. A different person holding Publish forms for `prod` in that workspace publishes it and is recorded as the approver. This stays inline on the form; there is no separate approvals queue for publish approvals.
- **Endpoint change in `prod`:** one holder of Publish forms for `prod` proposes it; it is held and not live until a different holder of Publish forms for `prod` confirms it.
- **While the rule is on, two administrative acts need an approver:**
  - turning the rule off;
  - adding yourself to a group that carries a response role.
- **Approver for those two acts:** a different Workspace administrator of that workspace, or a Site administrator who is not the requester.
- **Turning the rule on** is refused in a workspace where nobody else could approve: no second administrator, or no second holder of Publish forms for `prod`.
- Approver equals requester is always refused.
- With the rule off, an administrator may grant themselves response access. The grant and every later read are audited. Turning second approval on is how a workspace requires another person.

## 7. Accounts

### Creation

- A Site administrator creates an account by email address.
- The server generates a single-use, expiring sign-in link and emails it straight to that address. No administrator chooses, sees or receives a password or the link.
- First sign-in forces the person to set a password and enrol a second factor.
- Until then the account is **unclaimed**. Account creation, and every grant made while the account is unclaimed, writes an audit row.
- **Dependency: outbound email.** QCMS has no mail transport today. A transport, its configuration, the message template, delivery-failure handling and resend are v1 deliverables.

### Directory visibility

- Workspace administrators add a person by exact email address only.
- Adding an address that is unknown, disabled or unclaimed gets one generic answer, the same for all three.
- Browse and search of the account directory is for Site administrators only.

### Credential and factor reset

- A Site administrator may reset an account's password or second factor from the Accounts screen.
- In the same transaction, all of the account's sessions are revoked.
- The account's memberships of groups carrying a response role are suspended until a Workspace administrator of that workspace re-confirms each one. Other memberships are unaffected.
- Default: where another administrator exists, the re-confirmation comes from someone other than the person who performed the reset. On a sole-administrator site this cannot be enforced; the audit row is the only control, and the user guide says so.
- One site-audit row is written and mirrored to every affected workspace's audit.

### Disable

- One act, **Disable account**, by a Site administrator. It succeeds at once and ends every session.
- The last active Site administrator cannot be disabled.
- The confirmation shows what the person holds across all workspaces.
- If the person is the last Workspace administrator of any workspace, the confirmation lists those workspaces and the disable still proceeds.
- Disable keeps memberships. Workspace administrators cannot disable an account; they Revoke the person from their own workspace's groups.

### Reactivation

- The person sets a new password and re-enrols a second factor through an emailed link.
- Memberships of groups carrying a response role stay suspended until a Workspace administrator of that workspace re-confirms each one. Other memberships return at once.
- The reset default above, that someone other than the actor re-confirms, applies here too.

### Sessions

- The disabled flag is checked on every request.
- Sessions are deleted in the same transaction as a disable or a reset.
- A running export stops when its account is disabled.
- A pending assistant confirmation from a disabled account is refused.

## 8. Site administrators

- Accounts do not default to Site administrator. The first account, created by `qcms:create-admin`, is one. This is a prerequisite for every other rule in this section: today every account defaults to the claim (the `role` additional field in `apps/api/src/features/auth/instance.ts`).
- Promotion, demotion and suspension of a Site administrator are in-app acts with three guards:
  - step-up authentication, password and second factor, by the acting Site administrator;
  - approval by a second Site administrator where more than one exists;
  - an audit row in a table the application role cannot update or delete.
- These acts use an approval request at site level: request, approve, reject, expire.
- Default: with exactly one Site administrator, step-up alone suffices to promote a second.
- Default: the last active Site administrator can never be demoted, suspended or disabled in the app.
- Default: a pending request expires.
- The Site administrator role does not count toward any workspace's last-administrator guard.

## 9. Workspaces

- **Creation:** only a Site administrator creates a workspace. They name its first Workspace administrator by address, defaulting to themself. The four starter groups are created in the same act.
- **Rename:** the name only. The slug never changes.
- **Archive:** a Workspace administrator or a Site administrator, confirmed by typing the workspace name.
  - Refused while the workspace owns any form, closed and never-published ones included, with the reason inline.
  - Refused while the workspace is the shared question library.
  - There is no unarchive.
- **Move form:** a screen on the form.
  - Needs Edit forms in both the source and the destination workspace.
  - The confirmation states that the destination's groups will apply and names who gains and who loses access.
  - Responses move with the form.
- **Shared question library:** at most one workspace is marked shared; a Site administrator marks it. Its screen is a Site administrator rail row at two or more workspaces and hidden at one; question lists show a shared tag.
- **Workspace list:** every caller sees only the workspaces they hold something in; a Site administrator sees all. This ships first, as its own fix.

## 10. Guards and invariants

- **Last Workspace administrator:** removing or demoting the last active, claimed Workspace administrator of a workspace is refused for every actor, a Site administrator included. The Site administrator role never satisfies the guard.
- **Disable is the exception:** disabling an account always proceeds (section 7), even when it leaves a workspace with no active Workspace administrator.
- **Serialised membership writes:** every membership write in a workspace takes a per-workspace lock, so concurrent changes cannot jointly remove the last administrator.
- **Per-request state:** the disabled flag and every grant are read on each request. No cache may make a revoke or a disable take effect later.
- **One evaluator:** every assistant read, tool offer and proposed step is decided by the same policy evaluator as the screen act, under the user's own session (SEC-17). A suspended membership, a disabled account and a pending approval are rechecked at Confirm.
- **Groups stay inside their workspace:** a group grants nothing on another workspace's forms, groups or audit.
- **Revoke always succeeds** except where the last-administrator guard applies. Nothing about form coverage blocks a revoke.

## 11. Audit

Two append-only logs. For both, the application role holds `INSERT` and `SELECT` only, never `UPDATE` or `DELETE`. There is no auditor role.

| Log             | Holds                                                                          | Read by                                                        |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Workspace audit | Response reads, exports and erasures; workspace access acts; assistant actions | That workspace's Workspace administrators; Site administrators |
| Site audit      | Account and Site administrator acts                                            | Site administrators                                            |

- A site-level act that affects a workspace is mirrored into that workspace's audit.
- Every one of these acts writes a row:
  - **Accounts:** create, disable, reactivate, credential or factor reset, any grant while unclaimed.
  - **Site administrators:** promote, demote, suspend; approval request created, approved, rejected, expired.
  - **Workspace administrators:** appoint, remove.
  - **Access groups:** create, delete, change of roles or environments, member added, member removed, re-confirmation of a suspended membership.
  - **Workspaces:** create, rename, archive, form moved in or out, second-approval switch changed.
  - **Existing rows, unchanged:** response read, export and erasure; `prod` endpoint propose, confirm and withdraw; release-workflow change.

## 12. Navigation and screens

The shipped navigation stands: the top bar is app navigation with the workspace and environment choosers, and the left rail is on every screen. Access screens live in three homes:

| Home                   | Screens                                                                                                          | Who                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Workspace area         | Members, Access groups, Settings, Audit, Archive                                                                 | Workspace administrators, Site administrators |
| Site configuration     | Accounts, Site administrators, Approval requests, Site audit, Workspaces, New workspace, Shared question library | Site administrators                           |
| Account menu (top bar) | My account, My access                                                                                            | Everyone                                      |

- Forms, Operations and Responses screens change only in what they show or disable for the person's roles, with a short reason where an action is unavailable.
- There is no form-level access screen and no access step in form creation.
- The design canvas (https://claude.ai/artifact/S1Mt2WFT52Q9vKuqNPARD4) is the UI plan. No admin UI task starts until its screens are on the canvas and the Code Owner has seen them.

Routes are under `apps/admin/app/(shell)/`.

| Flow                                     | Who                                         | Route or location                                                | Design artboard | Status       |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- | --------------- | ------------ |
| My account                               | Everyone                                    | `settings/`                                                      | to be designed  | Partly built |
| My access                                | Everyone                                    | `me/access/`                                                     | to be designed  | Partly built |
| No access yet home                       | Account with no access                      | new                                                              | to be designed  | Not built    |
| Accounts list                            | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Create account                           | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Account detail: holdings, disable, reset | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Site administrators                      | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Approval requests                        | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Site audit                               | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Workspaces list                          | Site administrator                          | `workspaces/all/`                                                | to be designed  | Partly built |
| New workspace                            | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Shared question library                  | Site administrator                          | new (Site configuration)                                         | to be designed  | Not built    |
| Members                                  | Workspace administrator, Site administrator | `workspaces/[workspaceId]/members/`                              | to be designed  | Partly built |
| A person's access in the workspace       | Workspace administrator, Site administrator | new (side sheet on Members)                                      | to be designed  | Not built    |
| Access groups                            | Workspace administrator, Site administrator | `workspaces/[workspaceId]/access-groups/`                        | to be designed  | Partly built |
| New access group                         | Workspace administrator, Site administrator | new (level-2 rail row under Access groups)                       | to be designed  | Partly built |
| Access group detail                      | Workspace administrator, Site administrator | new                                                              | to be designed  | Not built    |
| Workspace settings                       | Workspace administrator, Site administrator | `workspaces/[workspaceId]/settings/`                             | to be designed  | Partly built |
| Workspace audit                          | Workspace administrator, Site administrator | `workspaces/[workspaceId]/audit/`, `assistant-actions/`          | to be designed  | Partly built |
| Archive workspace                        | Workspace administrator, Site administrator | new (rail row at two or more workspaces)                         | to be designed  | Not built    |
| Forms list                               | Form roles                                  | `forms/`                                                         | to be designed  | Partly built |
| Create form                              | Edit forms                                  | `forms/new/`                                                     | to be designed  | Built        |
| Edit form                                | Edit forms                                  | `forms/[formId]/`                                                | to be designed  | Built        |
| Publish to an environment                | Publish forms, and Edit forms for a draft   | `forms/[formId]/publish/`                                        | to be designed  | Partly built |
| Move form                                | Edit forms in both workspaces               | new (rail row on the form)                                       | to be designed  | Not built    |
| Availability, links, webhooks            | Publish forms                               | `operations/forms/[formId]/availability/`, `links/`, `webhooks/` | to be designed  | Partly built |
| Responses and export                     | View responses                              | `operations/forms/[formId]/responses/`                           | to be designed  | Partly built |
| Erase responses                          | Erase responses                             | `operations/forms/[formId]/erase/`                               | to be designed  | Partly built |

## 13. Shared UX patterns

Each is one reusable design.

1. **Access explanation:** rows of action by environment, each naming the granting group or "no group grants this". Used on My access and on a person's page.
2. **Preview before confirming:** who gains or loses what, in which environments, and whether approval is needed. The confirm button names the act.
3. **Confirmation levels:** plain confirm for reversible changes; typed name for irreversible ones (erase responses, archive workspace).
4. **Last-administrator controls:** Remove or Demote is disabled with the reason and a link to appoint someone else.
5. **No access yet home:** for an account with no access; names the administrator and links to My access.
6. **New workspace:** opens with the four starter groups and a short checklist.
7. **One-person site:** the first account is Site administrator, Workspace administrator and a member of all four starter groups.
8. **New environment notice** in Access groups: "Environment X: no group covers it yet."
9. **Scale:** search and rail filters (role, environment, status) on people, groups and accounts; results under 300 ms at 1,000 accounts.
10. **Accessibility:** full checkbox labels, announced errors, keyboard reachable, per `docs/COMPONENT_GUIDELINES.md`.

## 14. Acceptance criteria

Each criterion is tested against the real policy code, service or route as its task lands.

### Roles and environments

1. Every role by act by environment in the section 3 matrix is allowed where marked and refused elsewhere, including every blank cell.
2. A View forms holder is refused every write and every response read.
3. A View forms holder sees an endpoint URL with its query string masked; Edit forms and Publish forms holders see the whole URL.
4. An Edit forms holder without Publish forms cannot freeze a version or publish anywhere.
5. Publishing a draft to `test` succeeds for a person holding Edit forms and Publish forms for `test`, through one group or two.
6. Publishing a version to `prod` succeeds for a Publish forms holder for `prod` and is refused for one holding Publish forms for `test` only.
7. Publishing a draft straight to `prod` is refused under the default.
8. Open, close, link and webhook acts in an environment are refused for a person whose Publish forms groups do not name it.
9. View responses and Erase responses are refused in an environment the person's groups do not name.
10. An Erase responses holder cannot read or export a response.
11. A group holding only View forms or Edit forms is saved with no environment set and grants the same in every environment.
12. A newly added environment is covered by no group; a person in every existing group is refused every environment-scoped act in it.
13. Editing and saving a group never adds an environment the administrator did not select.
14. Creating or moving a form changes no group.
15. A new form is reachable at once by every holder of the matching role in its workspace.

### Administrators

16. A Workspace administrator with no group membership is refused every form, publish and response act in their workspace.
17. A Site administrator with no group membership is refused every response read, export and erasure in every workspace.
18. A person who is neither a Workspace administrator nor a Site administrator is refused each administrative act: Grant, Revoke, group create, change and delete, Workspace administrator appoint and remove, settings, audit read, archive.
19. A person who is not a Site administrator is refused each site act: account create, disable, reactivate, reset, directory browse, Site administrator promote, demote and suspend, approval decisions, site audit read, workspace create, shared library marking.
20. A Workspace administrator of workspace A is refused every administrative act on workspace B's people, groups, settings and audit.
21. A member of workspace A is refused every form, version and response of workspace B, by id as well as by list.
22. A group id from workspace B used in a Grant in workspace A is refused.
23. The workspace list returns only workspaces the caller holds something in; a Site administrator gets all.

### Second approval

24. With the rule on, publishing a version to `prod` is refused for the account that froze it and succeeds for a different Publish forms holder for `prod`, who is recorded as the approver.
25. With the rule on, a `prod` endpoint change is held until a different Publish forms holder for `prod` confirms it; the proposer's own confirm is refused.
26. With the rule on, links and open or close in `prod` need no approval.
27. With the rule on, a self-grant into a group carrying a response role is not applied until approved by a different Workspace administrator or a Site administrator who is not the requester.
28. With the rule on, turning it off is not applied until approved by a different Workspace administrator or a Site administrator who is not the requester.
29. In every approval, approver equals requester is refused.
30. Turning the rule on is refused where there is no second administrator or no second holder of Publish forms for `prod`.
31. With the rule off, a self-grant of a response role succeeds and writes an audit row.

### Accounts

32. Account creation emails a single-use, expiring link to the address; no response or screen shows the link or a password to the administrator.
33. A used or expired link is refused.
34. First sign-in through the link forces password set and second-factor enrolment before any other act.
35. An unclaimed account cannot act, does not count toward the last-administrator guard and cannot be an approver.
36. A grant to an unclaimed account writes an audit row.
37. A Workspace administrator adding an unknown, a disabled or an unclaimed address gets one identical answer.
38. A Workspace administrator cannot browse or search the account directory.
39. A credential or factor reset revokes every session of the account in the same transaction.
40. After a reset, the account's response-role memberships are suspended until re-confirmed per workspace; other memberships still work.
41. Under the default, the administrator who performed a reset cannot re-confirm where another administrator exists.
42. Disable ends every session at once; the next request on an old session is refused.
43. Disable stops a running export and refuses a pending assistant confirmation.
44. Disable keeps memberships; reactivation returns non-response memberships at once and keeps response-role memberships suspended until re-confirmed.
45. Reactivation requires a new password and second-factor re-enrolment through an emailed link.
46. Disabling the last active Site administrator is refused.
47. Disabling the last Workspace administrator of a workspace proceeds, and the confirmation lists that workspace.
48. A Workspace administrator cannot disable an account.

### Site administrators

49. A new account is not a Site administrator.
50. Promotion, demotion and suspension require step-up authentication by the actor.
51. With two or more Site administrators, promotion, demotion and suspension take effect only after a second Site administrator approves; the requester's own approval is refused.
52. With one Site administrator, step-up alone promotes a second (default).
53. Demoting or suspending the last active Site administrator is refused (default).
54. A pending request expires and can then no longer be approved (default).

### Guards

55. Removing or demoting the last active, claimed Workspace administrator is refused for every actor, a Site administrator included.
56. A disabled or unclaimed Workspace administrator does not satisfy the last-administrator guard.
57. Two concurrent removals that together would remove the last Workspace administrator leave at least one; one of them is refused.
58. A Revoke takes effect on the next request with no cache delay.
59. Every assistant tool offer and every proposed step for a user matches what that user's own screen acts allow.

### Workspaces

60. Only a Site administrator creates a workspace; it is created with the four starter groups and the named first Workspace administrator.
61. Rename changes the name and never the slug.
62. Archive is refused while any form remains or while the workspace is the shared library; there is no unarchive.
63. Move form is refused unless the actor holds Edit forms in both workspaces; after it, the destination's groups apply and the source's do not, and the form's responses move with it.
64. On a one-person site, the first account is Site administrator, Workspace administrator and a member of all four starter groups.

### Audit

65. Each act listed in section 11 writes exactly one row in its log, and a site act affecting a workspace also writes a mirrored row there.
66. The application role cannot update or delete a row in either log.
67. A Workspace administrator cannot read the site audit or another workspace's audit.

### Scale and accessibility

68. Search over people, groups and accounts returns in under 300 ms at 1,000 accounts.
69. New access screens meet `docs/COMPONENT_GUIDELINES.md`.

## 15. Decision records this document supersedes or amends

This document does not edit them. Each row is one passage to replace with a link here, or to correct as stated. Line numbers are at the commit that adds this document.

| Record                           | File and location                                                                                                  | Contradicting statement                                                                     | Replacement                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ADR-41                           | `docs/adr/core.md`, ADR-41 Status (line 451)                                                                       | "the six roles as disjoint statements, the environment and form scopes"                     | Five roles in groups, one environment set, no form scope; link here                                                  |
| ADR-41                           | `docs/adr/core.md`, ADR-41 "Membership is a set of grants" (line 461)                                              | grant is (administrator, workspace, role, environments, forms); environments a set or `all` | Group is roles plus one explicit environment set in one workspace; no `all`, no forms (section 3)                    |
| ADR-41                           | `docs/adr/core.md`, ADR-41 role families table (lines 463-466)                                                     | six roles; data roles scoped by environments and forms                                      | Section 3 matrix                                                                                                     |
| ADR-41                           | `docs/adr/core.md`, ADR-41 "A data row carries a form scope" (line 472)                                            | case officer limited to forms                                                               | No per-form authorisation; separate zones are workspaces                                                             |
| ADR-41                           | `docs/adr/core.md`, ADR-41 "Three of those routes split" (line 476)                                                | close and reopen by editor in dev and test, approver in prod                                | Publish forms for that environment                                                                                   |
| ADR-41                           | `docs/adr/core.md`, ADR-41 membership list visibility (line 478)                                                   | "owners and the installation admin"                                                         | Workspace administrators and Site administrators; rule stands                                                        |
| ADR-41                           | `docs/adr/core.md`, ADR-41 "Authoring and publishing are environment-agnostic" (line 480)                          | publishing a version needs only an authoring row                                            | A version is frozen only by publishing to an environment: Edit forms plus Publish forms (section 5)                  |
| ADR-41                           | `docs/adr/core.md`, ADR-41 mechanism bullets (lines 489-494)                                                       | `forms.owner` member role; one role per team with a `forms` scope; six static roles         | Workspace administrator flag; group with several roles and one environment set; five roles                           |
| ADR-41                           | `docs/adr/core.md`, ADR-41 additional-fields bullet (line 495)                                                     | `seedNewEditorsWithTestData` setting                                                        | Setting removed; Authors states `test` response access explicitly                                                    |
| ADR-41                           | `docs/adr/core.md`, ADR-41 access-group names (lines 499-503)                                                      | `<environments>.<role>[.<label>]` with one role, `all` and form labels                      | Redecided with the storage shape (section 16)                                                                        |
| ADR-41                           | `docs/adr/core.md`, ADR-41 Note "The production split is the matrix and not a scope" (line 519)                    | only `forms.approver` writes in `prod`                                                      | The split is group membership: Publish forms with `prod` in the set                                                  |
| ADR-41                           | `docs/adr/core.md`, ADR-41 Note "installation claim is modelled as a `forms.owner` grant" (line 521)               | claim acts as owner everywhere; five claim-only acts                                        | Site administrator administers every workspace, never satisfies the last-administrator guard; site acts in section 3 |
| ADR-41                           | `docs/adr/core.md`, ADR-41 Note on the bootstrapped first administrator (line 523)                                 | seeded with `all.forms.editor` and `all.forms.approver`, no response grant                  | First account is Site administrator, Workspace administrator and in all four starter groups                          |
| ADR-41                           | `docs/adr/core.md`, ADR-41 Note on the self-grant (line 529)                                                       | confirmed by a second `forms.owner` or the installation administrator                       | Different Workspace administrator, or a Site administrator who is not the requester (section 6)                      |
| ADR-41                           | `docs/adr/core.md`, ADR-41 Note on the seed setting (line 531)                                                     | seed setting stays                                                                          | Removed; "a grant on `test` responses is a grant on personal data" stands                                            |
| ADR-41                           | `docs/adr/core.md`, ADR-41 masked endpoint URL (line 533)                                                          | `forms.viewer` masked; `forms.editor` and above unmasked                                    | View forms masked; Edit forms and Publish forms unmasked                                                             |
| ADR-41                           | `docs/adr/core.md`, ADR-41 "Release to prod may require an approver" (line 535) and task 070 Notes (lines 537-541) | approver holds `forms.approver`; `forms.owner` does not approve                             | Approver holds Publish forms for `prod`; administrators approve only through a group (section 6)                     |
| ADR-41                           | `docs/adr/core.md`, ADR-41 Note "what the installation-wide claim may do" (lines 551-556)                          | claim on `user.role`, `admin` today, set by CLI only                                        | Explicit Site administrator role, not the default, appointed in-app under section 8 guards                           |
| SEC-1                            | `docs/SECURITY_DESIGN.md`, §2.1 session line (line 39)                                                             | server-side invalidation on sign-out and password change                                    | Also on disable and on credential or factor reset, in the same transaction                                           |
| SEC-1                            | `docs/SECURITY_DESIGN.md`, §2.1 "First admin via `qcms:create-admin` CLI only" (line 46)                           | no account creation outside the CLI; provisional password                                   | Site administrator creates accounts with an emailed single-use link; still no self-registration                      |
| SEC-1                            | `docs/SECURITY_DESIGN.md`, §2.1 "The recorded break-glass: `qcms:reset-2fa`" (lines 146-160)                       | reset never over HTTP; live sessions not revoked                                            | In-app reset with session revocation, response-membership suspension and mirrored audit (section 7)                  |
| SEC-3                            | `docs/SECURITY_DESIGN.md`, §3.1 (lines 273-275)                                                                    | six roles; claim `admin` that no request body sets                                          | Five roles in groups; Site administrator appointed in-app under section 8 guards                                     |
| SEC-3                            | `docs/SECURITY_DESIGN.md`, §3.2 "The two role families" matrix and notes (lines 312-350)                           | six-role matrix; `forms.owner` column; form scope; production split by matrix               | Section 3 matrix                                                                                                     |
| SEC-15                           | `docs/SECURITY_DESIGN.md`, §8b field table, detail row (line 740)                                                  | grant detail is `all` or the form list                                                      | Detail names the group's roles and environments                                                                      |
| SEC-15                           | `docs/SECURITY_DESIGN.md`, §8b readership (line 742) and control-role bullet (line 762)                            | "workspace's owners" and "the installation administrator"                                   | Workspace administrators and Site administrators; site audit added (section 11)                                      |
| SEC-15                           | `docs/SECURITY_DESIGN.md`, §8b kinds paragraphs (lines 748-752)                                                    | kinds closed at six; seed-setting row                                                       | New audited acts in section 11; seed setting removed                                                                 |
| SEC-15                           | `docs/SECURITY_DESIGN.md`, §8b self-grant rule (line 754)                                                          | second `forms.owner` or installation administrator confirms                                 | Section 6 approver rule                                                                                              |
| SEC-17                           | `docs/SECURITY_DESIGN.md`, §8d guarantee 3 (line 835) and agent audit readers (line 881)                           | role-family wording; "owners and the installation administrator"                            | Invariant stands; restate with section 10 and the section 2 vocabulary                                               |
| Q25                              | `plan/environments-and-workspaces.md`, §6 (line 218)                                                               | environments a set or `all`; publishing environment-agnostic                                | Explicit set; publishing names an environment                                                                        |
| Q27                              | `plan/environments-and-workspaces.md`, §6 (line 224)                                                               | authoring roles editor, approver, owner                                                     | Five roles plus administrator flags; form and response roles stay separate                                           |
| Q28                              | `plan/environments-and-workspaces.md`, §6 (line 225)                                                               | data role carries a form scope                                                              | No form scope                                                                                                        |
| Q30                              | `plan/environments-and-workspaces.md`, §6 (line 227)                                                               | `forms.approver` configures `prod` endpoints and mints `prod` links                         | Publish forms for `prod`; switch scope stands                                                                        |
| F17                              | `plan/environments-and-workspaces.md`, §6 (line 229)                                                               | a workspace may seed a new editor with a test response row                                  | No seeding; Authors carries View responses in `test`                                                                 |
| Q32                              | `plan/environments-and-workspaces.md`, §6 (line 230)                                                               | team carries one role and a `forms` scope                                                   | Group carries several roles and one environment set                                                                  |
| Q33                              | `plan/environments-and-workspaces.md`, §6 (line 231)                                                               | close and reopen split between editor and approver                                          | Publish forms per environment                                                                                        |
| Q34                              | `plan/environments-and-workspaces.md`, §6 (line 232)                                                               | approver is `forms.approver`                                                                | Publish forms for `prod`; rule otherwise stands                                                                      |
| Q37                              | `plan/environments-and-workspaces.md`, §6 (line 235) and "Access-group names" (lines 277-309)                      | one-role name grammar with `all` and form labels                                            | Redecided with the storage shape (section 16)                                                                        |
| Q38                              | `plan/environments-and-workspaces.md`, §6 (line 236)                                                               | six roles                                                                                   | Five roles; Workspace administrator is a flag                                                                        |
| Q39                              | `plan/environments-and-workspaces.md`, §6 (line 237)                                                               | `seedNewEditorsWithTestData` field                                                          | Removed; `externalGroupId` stands                                                                                    |
| Permissions matrix               | `plan/environments-and-workspaces.md`, "The permissions matrix" (lines 239-275)                                    | six-role matrix                                                                             | Section 3 matrix                                                                                                     |
| Q51                              | `plan/environments-and-workspaces.md`, §6 (line 338)                                                               | `prod` release by a `forms.approver`                                                        | By a Publish forms holder for `prod`; mechanism stands                                                               |
| Q56                              | `plan/environments-and-workspaces.md`, §6 (line 343)                                                               | second `forms.owner` or installation administrator confirms                                 | Section 6 approver rule                                                                                              |
| Q57                              | `plan/environments-and-workspaces.md`, §6 (line 344)                                                               | seed setting stays                                                                          | Removed; test data stays personal data                                                                               |
| Q58, Q73                         | `plan/environments-and-workspaces.md`, §6 (lines 345, 451)                                                         | masking by `forms.viewer` versus `forms.editor` and above                                   | View forms masked; Edit forms and Publish forms unmasked                                                             |
| Q61                              | `plan/environments-and-workspaces.md`, §6 (line 389)                                                               | grant detail is `all` or the form list                                                      | Detail names roles and environments                                                                                  |
| Q69                              | `plan/environments-and-workspaces.md`, §6 (line 434)                                                               | first-run seed `all.forms.editor` and `all.forms.approver`, no response grant               | First account in all four starter groups (section 4)                                                                 |
| Q79                              | `plan/environments-and-workspaces.md`, §6 (line 502)                                                               | SEC-15 kinds closed at six                                                                  | Revisit for the section 11 acts (section 16)                                                                         |
| Q4, Q85, Q86                     | `plan/environments-and-workspaces.md`, §6 (lines 208, 517, 518)                                                    | none                                                                                        | Stand; the no-draft-to-`prod` default is consistent with the prior-release default                                   |
| Q13, F5                          | `plan/environments-and-workspaces.md`, §6 (lines 214, 221)                                                         | none                                                                                        | Stand; add that turning the rule on is refused where nobody else could approve                                       |
| Q29, Q35, Q36, F10, Q64-Q66, Q70 | `plan/environments-and-workspaces.md`, §6                                                                          | none                                                                                        | Stand; vocabulary only                                                                                               |
| R5                               | `plan/workspaces-review.md`, §7 (line 290)                                                                         | none                                                                                        | Stands: Members, Grant, Revoke (see section 16)                                                                      |
| R8                               | `plan/workspaces-review.md`, §7 (line 293)                                                                         | "first owner"                                                                               | Stands; owner reads as Workspace administrator                                                                       |
| R11                              | `plan/workspaces-review.md`, §7 (line 296)                                                                         | none                                                                                        | Stands; the screen is in v1                                                                                          |
| R12                              | `plan/workspaces-review.md`, §7 (line 297)                                                                         | provisional account with forced password change; email invites later or never               | Emailed single-use link; outbound email in v1 (section 7)                                                            |
| R13                              | `plan/workspaces-review.md`, §7 (line 298)                                                                         | move form or question: not now, API only                                                    | Move form screen in v1 (section 9); question move undecided                                                          |
| R14                              | `plan/workspaces-review.md`, §7 (line 299)                                                                         | none                                                                                        | Stands; ships first                                                                                                  |
| R16                              | `plan/workspaces-review.md`, §7 (line 302)                                                                         | role checkboxes Form viewer, Form editor, Release approver                                  | Several roles per group stands; the checkboxes are the five roles                                                    |
| R17                              | `plan/workspaces-review.md`, §7 (line 303)                                                                         | role displays as "Release approver"                                                         | Withdrawn; Publish forms                                                                                             |
| R21                              | `plan/workspaces-review.md`, §7 (line 307)                                                                         | "There is no Move screen to empty it first"                                                 | Archive refusal stands; a Move form screen exists                                                                    |
| Design brief                     | `plan/design-brief-workspaces.md`, lines 37-38                                                                     | roles Form viewer, Form editor, Release approver; Owner on the person                       | Five roles; Workspace administrator                                                                                  |
| Design brief                     | `plan/design-brief-workspaces.md`, "Rulings that override" (line 68) and "Access map" (lines 73-77)                | no Move screen; six roles; group is role plus environments plus forms scope                 | Link here                                                                                                            |
| Webhooks guide                   | `docs/webhooks.md`, lines 23-37 and 132                                                                            | a `prod` endpoint change is a `forms.approver`'s                                            | Publish forms for `prod`                                                                                             |

## 16. Defaults and undecided items

### Defaults open to revision

- After a credential reset or a reactivation, re-confirmation of response memberships comes from someone other than the person who did the reset, where another administrator exists.
- With one Site administrator, step-up alone suffices to promote a second.
- The last active Site administrator cannot be demoted or suspended.
- A pending Site administrator approval request expires.
- `prod` accepts only a version already published to a non-prod environment.
- Questions keep "Publish" with its current meaning.

### Undecided

- Storage shape of an access group (several roles on one stored group, or one stored group per role) and the fate of the `<environments>.<role>[.<label>]` name grammar.
- Starter group environments on a site whose environments are not exactly `test` and `prod`, for example with `dev`.
- Whether suspending a Site administrator is a separate act from Disable account, and whether disabling a Site administrator needs step-up and a second approver.
- Mechanism and screen for workspace-level approvals (turning second approval off, self-grant): a stored request the approver confirms, or the approver performing the act.
- Whether a Site administrator counts as the second administrator when turning second approval on, and whether a Site administrator who is not a Workspace administrator there may re-confirm a suspended membership.
- How a person regains sign-in after a credential reset.
- Lifetime of the sign-in link and of a pending approval request.
- Whether `qcms:create-admin` and `qcms:reset-2fa` remain beside the in-app acts.
- Moving a question between workspaces: the API exists; no screen is ruled.
- Label of the workspace person list: Members (R5) or People.
- Account deletion: only disable is ruled.
- Audit kinds for the new acts, given SEC-15's six closed kinds (Q79), and the site audit's row shape.
- Whether the no-draft-to-`prod` default is a release-workflow revision (Q85) or fixed.

## 17. Out of scope

- Per-form authorisation of any kind, including form-limited response groups and form-level access screens.
- Data migration, upgrade paths and backward compatibility.
- An auditor role.
- Unarchive.
- A separate approvals queue for publish approvals.
- Emergency suspension as a separate act.
- A coverage engine, a Form creators group, group picking at form creation and an eligible-editor check.
- Second approval outside `prod`, and for links or open and close.
- The seed-new-editors-with-test-responses setting.
