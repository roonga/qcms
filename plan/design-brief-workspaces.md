# Design brief: the Workspaces area

## Problem

The area that manages who may do what is the least finished part of the admin, and a one-workspace site sees all of its multi-workspace machinery.

- Five screens per workspace (Members, Access groups, Workspace settings, Access audit, Assistant actions) plus an "All workspaces" table. Access groups mixes list, grant, revoke, remove and a long create form on one screen; Members only toggles ownership; nothing adds a person, creates a workspace, archives one or marks the shared library, although the API can do all of it (except add a person: no account-creation path exists outside the operator CLI).
- Wire vocabulary leaks everywhere: group titles like `all.forms.approver`, the naming grammar `<environments>.<role>[.<label>]` as a help paragraph, "Member row", audit kinds `grant`/`revoke`, assistant rows with `access.grant`, `1 of 3`, a route pattern and a raw id as "Detail".
- The breadcrumb says "Workspaces / Default workspace / Access groups" and the page repeats "Workspace: Default workspace" under it. The rail carries "‹ All workspaces" even when there is one workspace.
- Most installations have one workspace. The multi-workspace shell (switcher, list, archive tags, shared library) exists for the few that have several.
- Full findings: `plan/workspaces-review.md`.

## Ask

Design the whole area for both cases: one workspace (the common case) and several. Every function becomes one screen reached from the left rail, in plain language, with wire names kept under Advanced.

## Decisions needed

1. **Rail rows and the one-function split.** Proposed, one workspace: People, Give access (level 2 under People), Access groups, New access group (level 2), Settings, Audit (tabs: Access, Assistant), with Archive workspace appearing only at two or more. Confirm the rows, their order, what is a screen and what is a side sheet (a row's detail and its own operations) or a dialog (a confirmation).
2. **Tabs.** Allowed where one function has alternative views. Proposed: Audit has Access and Assistant tabs over the same filters and readership. Say whether anything else in the area qualifies; People versus Access groups and list versus create do not.
3. **One workspace.** Nav label ("Access" proposed, "Workspaces" at 2+), breadcrumb "Access / People" with no workspace crumb, no switcher, no "All workspaces" row, no archived or shared-library concepts, no "in this workspace" qualifiers.
4. **Two or more.** Where "All workspaces", "New workspace" (installation administrator only) and "Shared question library" (administrator only) sit relative to the current workspace's rows; what the list shows (name, owners, forms, questions, status); how the top-bar switcher (shipped in #1236) and the list relate so the choice is offered once.
5. **Promotion.** What changes on screen when the second workspace is created, and what reverts when one is archived.
6. **People.** The list columns (person, owner, what they hold), the side sheet for one person (grants with Remove access, Make owner / Remove owner), the empty state, and how a person with no grants reads ("No access").
7. **Give access.** A short screen: pick a person (existing accounts only), pick an access group or a role plus scope; what the confirmation says; where the two-person self-grant refusal and the personal-data note for test responses appear.
8. **Access groups.** A group's plain title ("Form editor, all environments, all forms"), the list, the side sheet (people with this group, Remove access, Delete group), and the New access group screen: Role with one-line description, Environments, Forms (All or picked by name, with search), Advanced holding label, stored name, full name and directory name.
9. **Settings.** The two switches (two-person rule for production; give new editors dev and test response access) as short labels with the rules behind `?`; whether the workspace name is edited here (rename API to be added) and whether Archive is a separate rail row (proposed) rather than a button here.
10. **Audit.** Rows as sentences ("Gave Form editor (all environments, all forms) to a.b@example"), filters (kind, person) in the rail, a pager; the Assistant tab grouped by plan ("Plan of 3 steps, confirmed by ...") with the card title as the action, the section name instead of a route, resolved names instead of ids, and a one-line note that every row is a confirmed, completed step.
11. **Workspace lifecycle at 2+.** New workspace (name, first owner by address), Archive (typed confirmation, blockers listed when refused, no unarchive), Shared question library (pick a workspace or none).
12. **Accounts.** Nothing in the product creates an account except the CLI. Say what the People screen promises when no account exists yet (a pointer to a future Site configuration > Accounts screen, administrator only), so the design does not imply an invite flow that is not there.
13. **Help and wording.** Which sentences survive as `?` tips and which disappear; the role descriptions as the one place the production split is explained.

## Constraints

- Admin only. One persistent rail per area, a tree of at most two levels, every row its own screen, one title per screen, a breadcrumb row on every screen (`plan/admin-design-contracts.md` §7.00, §7.01). Filters live in the rail; lifecycle and destructive actions live in the content, never in the rail.
- **One function per screen, navigation through the left rail only.** Each screen has one job and one primary action. No nested screens: no drill-down, no screen reachable only from inside another screen's body. A side sheet or dialog may hold one row's details and that row's own operations; it has no address. Creation is a screen of its own. Tabs only for alternative views of the same function.
- The API authorises; hiding a control is never the boundary. Only workspace owners and the installation administrator reach the area; the administrator reads no response data anywhere.
- Roles are fixed: Form viewer, Form editor, Release approver, Response viewer, Response eraser as groups; Owner on the person. Group names follow `<environments>.<role>[.<label>]` and are labels, not mechanisms; show them under Advanced only. A form editor scoped to all environments still cannot act in production; say that in the role description, not as a note on the screen.
- Grants name existing accounts only. A removed account must still read in the audit (as an id with "(removed)").
- Audit rows carry acts, never answer values, respondent identifiers or question text.
- A workspace is an access boundary: the current one must be unmistakable at 2+ and never colour-coded (colour is reserved for environments).
- Keyboard and screen reader: accessible names contain the visible text; side sheets trap focus and return it; tabs are a `tablist`.
- Phone width and all four themes (light, dark, hc, hc-dark). Selected-row rail mark, `?` help pattern and the page-header pattern as in the design system.
- Every admin file is mirrored under `packages/create-qcms-app/templates`, so prefer fewer components.

## Deliver

- Desktop and phone mockups for every rail row at one workspace and at three: People (list, side sheet, empty), Give access, Access groups (list, side sheet, empty), New access group, Settings, Audit (both tabs, filters, grouped assistant rows), All workspaces, New workspace, Archive workspace, Shared question library.
- The rail at one workspace and at three, with the level-2 rows shown under their parent and the collapsed 56px strip.
- The breadcrumb, nav label and switcher in both cases, and the moment of promotion.
- A ruling on each decision above, the wording table (section 5.2 of the review) confirmed or amended, and the `?` texts.
- Update the QCMS design system artifact in the same pass: a People card, an Access groups card, an Audit card with the sentence pattern, and the one-function rule in the brand book.

## Current implementation (for reference)

- Routes: `apps/admin/app/(shell)/workspaces/{page,all/page}.tsx`, `[workspaceId]/{members,access-groups,settings,audit,assistant-actions}/page.tsx`, server actions in `[workspaceId]/actions.ts`; sections and hrefs in `apps/admin/lib/membership/sections.ts`.
- Panels: `apps/admin/components/membership/{members-panel,access-groups-panel,workspace-settings-panel,audit-panel,agent-audit-panel,my-access-panel,workspace-screen,workspaces-rail,workspaces-rail-slot}.tsx`; the form helper `apps/admin/lib/membership/access-group-form.ts`; types in `lib/membership/types.ts`.
- Shell: `apps/admin/components/shell/workspace-switcher.tsx`, `apps/admin/lib/shell/{workspace-context,workspace-switch,breadcrumbs}.ts`, `apps/admin/lib/server/workspace-context.ts`, `apps/admin/app/(shell)/layout.tsx:78-79` (switcher only at 2+).
- API: `apps/api/src/features/membership/{route,handler,route-policy,policy}.ts`, `apps/api/src/features/workspaces/{route,handler,README}.md|ts`, `apps/api/src/features/agent/audit.ts`; audit tables `packages/db/src/schema/control/{access-audit,agent-actions}.ts`.
- Copy: `apps/admin/lib/i18n/en.ts:2267-2426` (`membership.*`), role names `:2281-2297`, card titles `:1611-1707`, section labels `:1538-1542`.
- Decisions: ADR-41 (`docs/adr/core.md:449-572`), SEC-3 and SEC-15 (`docs/SECURITY_DESIGN.md`), `plan/environments-and-workspaces.md` §6, `docs/features/068` to `070`, `plan/admin-design-contracts.md` §7.00 and §7.01.

## Rulings that override the text above (Code Owner, 2026-11-08)

- Area label is "Workspace" at one workspace, "Workspaces" at two or more; at one workspace the crumb keeps the name, with no "All workspaces" row, back link or `/workspaces/all`, and no "Workspace: name" line.
- Keep the words Members, Grant and Revoke (not People / Give access / Remove access).
- Creation is a level-2 rail row; Audit is one rail row with Access and Assistant tabs; Archive is its own rail row at two or more workspaces; the shared library and Accounts are installation-admin rows; no Move screen.
- Plain role, environments and forms in words; stored names under Advanced only.
  See plan/workspaces-review.md section 7 for the full list.

## Access map (reference for the managing screens)

Matrix of installation, environments, workspaces, members, access groups, roles and the acts each can run: https://claude.ai/artifact/BYDtci7dm4D4j7ZGcgiyew (private; Code Owner shares on request).

- Roles: `forms.viewer`, `forms.editor`, `forms.approver` (only role with prod writes), `forms.owner` (administers, touches nothing inside), `responses.viewer`, `responses.eraser`. The installation claim acts as owner in every workspace, has no member row and reads no response data.
- An access group is a role plus environments plus a forms scope.
- Design the management flows end to end: who sees what at one workspace versus two or more, add and remove members, grant and revoke, create and archive a workspace, mark the shared library, and the installation-admin rows. Each is one screen from the left rail.
- R16: an access group takes several roles (multi-select on the New screen). Not one role per group.
