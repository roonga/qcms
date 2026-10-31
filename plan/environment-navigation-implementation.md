# Environment navigation and publishing: implementation handover

Status: implementation proposal, prepared 2026-10-28. Runtime implementation has
not started on this branch. The branch preserves the interactive exploration and
this handover; it is not a production-ready feature.

## Authority and scope

**The environment-navigation POC is guidance for flow, navigation and interaction.
It is not the source of truth for look and feel.** Use existing application
components, approved screen contracts, accessibility patterns and design tokens.
Do not copy its standalone CSS, dimensions, spacing, fonts, colors or fixture
personas into production. A narrowly scoped exception in
[admin design contracts](admin-design-contracts.md) records this instruction.

This plan records the latest agreed interaction direction. The
[interactive POC](admin-shell-poc/environment-navigation-poc.html) illustrates it;
its [notes](admin-shell-poc/environment-navigation-poc.md) describe preview limits.
The [navigation inventory](admin-shell-poc/top-nav-reconciliation.md) maps existing
entry points. The earlier [independent recommendation](environment-ux-recommendation.md)
is historical input, not the final specification. Where mock access behavior
conflicts with the audited policy below, the existing policy governs.

Audited runtime baseline: `origin/main` at `8dd38ea5`; POC baseline before this
handover: `d04a5041`. Recheck live code and migrations before implementation.
This plan changes no authorization, API, database, CI or deployed stack.

Deliver one admin application with three navigation modes, a shared authoring
surface, a unified Versions view and one publishing wizard. Preserve all existing
capabilities, including ones the POC does not draw. Styling redesign, a separate
operations app, custom roles, multi-tenancy and multi-owner forms are outside scope.

## Navigation and context

| Context              | Application navigation                                                                             | Context navigation and entry behavior                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Normal               | Questions, Forms, permitted Workspaces, a separated Operations entry, permitted Site configuration | Rail contains navigation for the selected question or form. No global workspace label or switcher.                                                                 |
| Operations           | Dedicated Operations header with explicit environment selector; normal menus hidden                | Start at a searchable forms table. Selecting a form reveals its permitted Overview, Responses, Links and Webhooks rail. Global queues have their own destinations. |
| Workspace management | Dedicated Workspaces mode; normal menus hidden                                                     | Start at manageable workspaces. Selected workspace rail contains Members, Access groups, Workspace settings and Access audit.                                      |

Settings and My access belong under the avatar. Show only the avatar in the header;
identity is inside its menu. Keep the existing appearance utility. Personal
Settings includes account, password, two-factor authentication and recovery flows;
it is distinct from workspace settings and proposed installation release settings.
Opening personal settings in a focused mode must preserve that mode and keep normal
menus hidden. Choose a route or dialog using existing accessible application patterns.

Operations and Workspaces each have an explicit Exit action only when the caller
has another permitted area. Restore the last permitted context, with a safe fallback
if permissions changed. Operations-only users land in Operations; workspace-only
managers land in Workspaces. A caller with no feature grants still has personal
settings, My access and a useful access-request/empty state. Do not fabricate authoring
access to give them a landing page. Denied bookmarks must offer a permitted recovery
route without leaking inaccessible form or workspace names.

The Workspaces menu is for management, not general membership. A workspace owner
sees only workspaces they manage; an installation administrator manages all.
Provide All workspaces in that mode even when a selected-workspace bookmark is
rejected. Site configuration is a proposed installation-administrator destination,
not an additional power for every `forms.owner`.

The left rail is context navigation, never the application menu. The POC's Draft
and Versions links are illustrative: retain existing form steps, Rules, Preview,
question details and other real screens. The POC omits rails on lists; reconcile
this deliberately with existing route/rail contracts rather than treating the
mock's absence as approval to remove shipped navigation.

### Lists and filter boundaries

- Replace the form dropdown with a proper Operations forms table. Support bounded
  search by display name/identifier, workspace and intake filters, stable sorting
  and pagination. Show current released version, intake, last release, and response
  counts only with the corresponding response-read permission.
- List filters affect results below them. They never change the header, mode,
  environment selection, selected workspace above the list or page heading.
  Apply the same principle to normal Forms and Workspaces lists.
- Environment changes are explicit Operations-wide changes, reset pagination and
  preserve only valid filters. No list filter changes global workspace context.
- Preserve list state in URLs across detail navigation, All forms, refresh and
  browser back. Preserve each mode's remembered state without making it an
  authorization input. Re-entering Operations returns to its forms list.
- Delivery failures and Erasure log are global operational destinations with
  existing installation-only authorization. Workspace/form-list filters do not
  scope these endpoints. Returning to the table restores its previous filters.
- Distinguish no release, closed intake, no matching results, denied access,
  loading and failed requests. Do not render an API failure as an empty installation.
  A form with no release cannot accept sessions or mint a usable intake link.

### Authoring and sharing

Authoring edits a shared draft, independent of the selected Operations environment.
Published snapshots are immutable. Editing questions while production serves an
older snapshot is valid and does not modify that production version. Keep existing
immutable question pins and deliberate adoption of newer question versions.

Each form has one owning workspace. Existing shared-library question reuse and
cross-workspace user grants do not make a form jointly owned. Moving ownership,
cloning and adding multi-workspace sharing are different operations and are not
introduced by this plan. Fictional workspace names in the POC are not new domain
concepts or installation defaults.

## Versions and publishing flow

Merge the existing version and release views into **Versions**. Each immutable
version row shows its identity, publisher, review access and **Available in**:
environments currently releasing that version, not every historical destination.
Use a stable Review action on each row. Do not add a variable Next action column.
Provide current environment/version/intake summaries and append-only release
history, with the existing rollback capability retained.

Code Owner, 2026-10-31: the builder's publish dialogs are retired; the wizard is the
only publish entry.

One **Publish** entry opens the wizard:

1. Choose the shared draft or an existing immutable version. An approver can choose
   an existing version without draft-edit or version-publish permission.
2. Choose eligible destination environments. For a draft, also offer **Create version
   without releasing** as an exclusive choice, subject to `form:publish`.
3. Review each destination's current version to candidate transition, intake state,
   eligibility evidence, publisher and relevant second-person or rollback effects.
4. Confirm once. Present the recorded result and links to affected Operations
   contexts. Offer the correct environment-specific test/intake link only once it
   exists; do not derive it from a browser's unrelated environment preference.

Omit destinations outside the caller's action-specific access. Show accessible but
workflow-blocked destinations disabled with a reason. Back/cancel makes no writes;
changing source clears dependent selections. Refresh stale review information and
require confirmation again before committing changed intent.

A site can choose a single production destination, test/prod, an ordered
dev/test/stg/prod flow, or permitted flexible destinations. These are proposed
owner-configurable workflows, not existing backend presets. Environment order alone
does not define prerequisites. Do not require switching a global header environment
to publish: destinations belong to the explicit wizard. The Operations selector
controls operational data, not where a draft is silently released.

Allow multiple destinations only when the configured flow permits it. Each target
must independently satisfy its prerequisites from committed state before the batch.
Selecting dev and test together does not qualify test if it requires a prior dev
release of that version. A draft creates one immutable snapshot reused by all
targets. The operation is all-or-nothing, not a client-side loop over releases.

For an ordered dev/test/stg/prod site, the normal journey is: edit draft; publish to
dev; verify it; use the wizard on that same version to release to test, then stg,
then prod as access and prerequisites permit. An owner may select another flow.
Prior release evidence does not prove that someone tested or approved the version.
There is no persisted test-pass evidence or approval inbox today.

Preserve these invariants:

- Release and rollback select exact immutable versions. Existing sessions keep their
  pinned starting version. Releasing does not reopen closed intake.
- `prod` remains the existing protected production identifier. Its role split and
  optional workspace second-person rule survive every configurable flow.
- With second-person approval enabled, the production releasing account differs
  from the snapshot publisher, including rollback. A prod-only site therefore needs
  Create version without releasing followed by another account's release.
- An uncertain response after confirmation needs idempotent replay or result lookup.
  Do not create another version just because the browser timed out.

## Existing role and permission model

Audit sources: [policy](../apps/api/src/features/membership/policy.ts),
[route policy](../apps/api/src/features/membership/route-policy.ts),
[resolver](../apps/api/src/features/membership/resolver.ts),
[middleware](../apps/api/src/features/membership/middleware.ts),
[two-person checks](../apps/api/src/features/membership/two-person.ts),
[security design](../docs/SECURITY_DESIGN.md), and the existing
[permissions specification](environments-and-workspaces.md).
The code audit identifies implementation gaps; it does not silently amend the
normative permission matrix or ADRs.

The six roles are independent statements, not ranks. Multiple grants contribute
rights only within their actual owning-workspace and action scopes. Default plugin
role strings do not confer QCMS feature permissions. Never authorize by parsing a
group's display name or using the POC's persona flags.

| Role or claim              | Existing capabilities                                                                                              | Important exclusions                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `forms.viewer`             | Read questions, forms, releases, links and webhook configuration in its workspace                                  | No edits, publish, draft preview, response read or membership list; preserve server-side webhook URL masking |
| `forms.editor`             | Author/publish/preview; read control-plane configuration; scoped non-prod release, intake, link and webhook writes | No production writes through this role, no response access                                                   |
| `forms.approver`           | Read control-plane configuration; scoped release, intake, link and webhook writes, including prod                  | No draft editing, snapshot publishing or draft preview; second-person checks still apply                     |
| `forms.owner`              | Workspace membership administration, settings/archive and access audit                                             | No form, question, release, link, webhook or response capabilities from ownership alone                      |
| `responses.viewer`         | Response read/export within granted form and environment scopes                                                    | No authoring or operational configuration rights                                                             |
| `responses.eraser`         | Response erase and disposition/unflag within granted scopes                                                        | No response read/export or global erasure history from this role alone                                       |
| Installation `admin` claim | Administration across workspaces; installation-only endpoints such as global queues/logs                           | No automatic form authoring/release or response read/export/erase; requires independent grants               |

Environment-scoped actions are form close, release create, link mint/revoke,
webhook configure, and response read/export/erase/dispose. Only response actions
also have the form-scope dimension. Authoring, version publishing, draft preview
and control-plane reads are environment-agnostic. An editor with `all` environment
scope still cannot perform production writes through the editor role.

`GET /admin/me/access` is available to signed-in callers for their own grants.
`GET /admin/environments` returns the union of environments held in grants, or the
served set for the installation claim. Neither is proof that a caller may release
a particular form into every returned environment.

### Gaps to close and POC shortcuts to reject

| ID  | Existing behavior or mismatch                                                                                                                  | Implementation requirement                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G01 | POC form navigation derives read access from edit/release flags and omits a true viewer persona                                                | Derive navigation and per-action controls from real effective capabilities, including read-only access; API remains authoritative                             |
| G02 | Response-only users cannot use `GET /admin/forms`, which requires `form:read`; existing Responses index is a form picker                       | Add a minimal authorized Operations discovery query without granting draft/control-plane read to response roles                                               |
| G03 | Global dead letters require the installation claim; global erasure history also requires it, and no six-role grant contains `response:history` | Correct POC assumptions: editor/approver/eraser roles alone cannot see those global screens; no implicit policy broadening                                    |
| G04 | Per-form redelivery requires `webhook:configure` in that form's workspace/environment                                                          | Queue visibility does not imply retry access; authorize each retry, including prod split. POC Retry all is not an existing bulk contract                      |
| G05 | Erasers may act without response-read permission                                                                                               | Decide a safe known-target erasure journey or require an additional viewer grant for browsing; never silently grant response read                             |
| G06 | An installation administrator may access global logs but no form data                                                                          | Support Operations entry with only authorized global destinations and no forced form-list access                                                              |
| G07 | POC workspace and site-owner labels are simplified                                                                                             | Use actual owner grants for workspace management and installation claim for installation settings; do not add authoring rights                                |
| G08 | Workflow presets, multi-target publish and arbitrary protected names exist only in the POC                                                     | Implement explicit configuration and batch contracts; retain literal `prod` protection and operator environment provisioning                                  |
| G09 | Current forms list lacks the proposed pagination, workspace filters, per-env release summaries and protected response counts                   | Build an authorized list DTO/query; latest published version and publication time are not current release/version or release time                             |
| G10 | Current global environment preference influences shell, authoring and actions                                                                  | Remove implicit authoring environment dependence deliberately; use explicit Operations context and publish targets while preserving stale-context protections |
| G11 | POC review checks are simplified and browser-local                                                                                             | Server rechecks policy, grants, release sequence and intake at commit; implement atomicity and idempotent results                                             |
| G12 | No server-computed navigation/action capability contract for the proposed shell                                                                | Add a narrowly scoped projection using existing policy; do not return unrelated memberships or treat failed discovery as permission denial                    |

Workspace switches `requireSecondApprover` and `seedNewEditorsWithTestData` already
exist. Preserve their workspace scope and response self-grant/two-person safeguards.
The POC's site-wide approval toggle is not a replacement. Workspace creation and
marking the optional shared library are installation-only API operations; a general
workspace member does not gain these powers through the new menu.

## Backend contracts and migration

### Release-flow configuration

The current [workflow implementation](../apps/api/src/features/releases/workflow.ts)
recognizes literal `test` plus `prod`. It permits production candidates with prior
same-form release evidence in test or prod, preserving legacy rollback candidates.
Combined draft publish to prod is blocked in that deployment. A prod-only deployment
has different existing behavior. Migrate this deliberately rather than enabling a
new permissive preset by default.

Proposed scope: installation-wide release-flow configuration writable only by the
installation claim, referencing existing served environments. Keep workspace approval
requirements separate. Select an explicit prerequisite representation and versioned
configuration; do not infer a graph from environment `position`. Record the new
policy in an ADR and the permission matrix before exposing configuration writes.

Environment provisioning/deletion remains operator CLI/database-role work. This
screen configures workflow over already provisioned environments; it does not run
HTTP DDL. Arbitrary production names, renamed protected environments and deployment
provider changes are separate work requiring routing, authorization and migration
review. The POC's free-text environment editor is exploration only.

### Candidate review and atomic confirmation

Define server contracts for a permission-filtered candidate review and confirmation.
Review should return source identity, workflow revision, current release sequence
and intake per target, applicable blockers and a review token or equivalent
concurrency data. Return only information the caller may inspect.

Confirmation must reauthorize `form:publish` for a draft and `release:create` for
**every** target in the form's owning workspace. A single request environment or
header cannot authorize the other targets. Recheck second-person rules, prior-release
prerequisites, workflow revision and draft/source revision at commit. Check release
sequence and intake, not only version number: close/reopen can change state while
the version stays the same.

Use one transaction with deterministic locking/CAS across targets: freeze the draft
once, append each release, and enqueue each environment's event using existing
schema-qualified outbox patterns. Any invalid target rolls back the whole operation.
Do not widen control-plane database privileges into response schemas. Define a
principal/form/intent-bound idempotency key, reject key reuse with changed intent,
and replay the recorded result after uncertain transport failure. Specify how the
client looks up an outcome after reload.

### Operations discovery

Add a bounded, indexed query returning only minimally necessary form metadata for
valid operational capabilities in the requested environment. Filter before totals,
aggregation and pagination; use stable tie-breaking sort keys. Limit workspace filter
options to authorized names. Avoid per-row draft fetches and N+1 release queries.
A response-only user must not receive draft bodies or unrelated forms. Counts and
count sorting require response-read rights for that exact form/environment, not
an owner/admin/editor badge. Use the correct environment data pool for response
aggregates; no control-role response grants as a shortcut.

Represent unreleased separately from closed intake. Metadata access alone cannot
mint links, reopen intake, inspect answers or configure endpoints. Shared identity
settings such as challenge requirements and minimum submission time remain shared
settings, even if an Operations screen links to their authorized editor.

### Routes and application integration

- Register a shell mode and context model, not string matching scattered through
  menu components. Preserve server checks for direct routes and server actions.
- Give Operations environment and detail/list state explicit URLs. Keep any last-env
  preference as a convenience, never authorization; handle stale cookies and tabs.
- Redirect legacy `/responses` to the operational form picker; map selected-form
  Responses/Links/Webhooks routes to their matching form/environment contexts.
  Preserve query context, outcome banners, copyable URLs and browser history.
- Preserve `/webhooks` global queue and `/responses/erasures` log as authorized
  aliases or redirects; they are not substitutes for per-form configuration.
- Retain existing public/test-link origin and environment-prefix handling. Verify
  copied links in the local Docker stack and deployed origins rather than composing
  URLs from a header label.
- Follow the [shell route instructions](<../apps/admin/app/(shell)/AGENTS.md>): route
  registrations, title/measure/save model, rail slots, route tests and reflow
  fixtures must remain complete. Reconcile full form subtree navigation through
  `apps/admin/lib/forms/subtree-rail.ts`.
- Keep business rules in API/core seams; BFFs proxy/authenticate. Update schemas,
  OpenAPI, route-policy coverage and normative security docs together. Existing
  closed resource vocabulary must not be expanded accidentally by a new route.
- Runtime changes belong in `apps/*`; regenerate scaffolding with
  `pnpm qcms:sync-templates` and add the appropriate changeset when shipping them.

## Delivery work packages

| Phase                      | Deliverable and main seams                                                                | Exit criteria                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1. Contract decisions      | ADRs, permission matrix, workflow migration, minimal discovery/capability DTOs            | Resolve the decisions below; retain existing security unless an explicit policy change is approved                         |
| 2. Authorized read model   | Membership policy projection; Operations discovery and candidate review; database queries | Role/form/env negative tests pass; no draft or response leakage; stable pagination and useful denied/error states          |
| 3. Publish transaction     | Workflow persistence/migration; forms/releases handlers; idempotency and outbox           | One snapshot and atomic releases; stale review/refused target creates nothing; existing installations retain safe defaults |
| 4. Shell and lists         | `AdminNav`, shell layout, avatar, modes, context rails and route aliases                  | Every existing entry is accounted for; focused mode never reveals inaccessible normal navigation; filters remain local     |
| 5. Versions and wizard     | Existing form authoring/version/release components and new candidate/confirm clients      | One publish entry, stable version actions, accurate Available in, readable per-target review and recoverable outcomes      |
| 6. Operational integration | Responses, Links, Webhooks, intake, global queues/logs and workspace mode                 | Existing functions preserved under real permissions; actual links work in the chosen environment                           |
| 7. Shipping                | E2E/CI coverage, template sync, changeset, user/security/architecture docs                | Required gates green; exact PR head independently reviewed; comments resolved before merge                                 |

**Phase 1 is ruled (PR #1163); phases 2 and 3 have landed (issues #1174 and #1181).**
Phase 2 delivered the authorized read model and nothing beyond it: the `anyOf`
route-policy row shape and `environmentFrom: "query"`, `GET /admin/operations/forms` with
its per-role projection and cursor pagination, the stateless
`POST /admin/forms/{id}/release-review`, and `capabilities` on `GET /admin/me/access`.
Phase 3 delivered the write half: the two release-workflow tables and their two routes
(decisions 1 and 4), `environmentFrom: "targets"`, `POST /admin/forms/{id}/release-batch`
and `POST /admin/forms/{id}/publish-batch` with one transaction, deterministic locking and
a principal-and-form-scoped idempotency key, `GET .../release-batches/{key}`, the draft
`revision` of F2, and the seven-day retention step. With no revision written the review
still reports `workflowSource: default` and `workflowRevision: null`, and a missing
production prerequisite keeps the `TEST_RELEASE_REQUIRED` code (F5); `PRIOR_RELEASE_REQUIRED`
arrives with the first configured revision. The dispose and erase journeys stay on their
existing routes (G05, F3) and their user documentation lands with phase 6's screens. The
wizard that drives the two batch routes is phase 5's; nothing in the admin calls them yet.

Read-model work can start after its contract decisions without waiting for the whole
shell. Do not wire a cosmetic wizard to repeated single-target mutations while
waiting for phase 3. Do not release navigation that strands response-only users
before phase 2 supplies safe discovery.

### Decisions required before their dependent implementation

1. Choose workflow schema and migration defaults. Recommendation: preserve existing
   test/prod prerequisites and legacy production rollback eligibility; other existing
   deployments retain their current semantics until explicitly configured.
2. Define prerequisite evidence and rollback exceptions. Recommendation: prior
   committed release evidence only for this scope; persisted test-pass gates and
   formal approvals require separate product/security work.
3. Define exactly which operational metadata each role may discover, including
   eraser-only navigation. Recommendation: minimal safe metadata and no implicit
   response read or authoring grants.
4. Define installation configuration read/write actions and update the closed policy
   matrix. Recommendation: installation-only writes; permission-filtered evaluation
   for publishers, not broad administration access.
5. Confirm concurrency, idempotency retention and retry-result contracts before
   building the confirmation client. They are necessary for the proposed atomic UX.

These are design dependencies, not permissions granted by this handover. Prepare
concrete contracts and the affected ADR/security changes for Code Owner decisions;
do not weaken existing policy to make the POC behave literally.

## Verification and acceptance

Use policy/integration tests for authorization and transaction behavior, then
Playwright for the observable journeys. The POC's browser-memory checks do not
prove runtime security, atomicity, database isolation or real environment routing.

Required personas include forms viewer; test-only editor; prod-only approver;
response viewer restricted to one form/environment; eraser without viewer;
workspace-only owner; installation administrator with no data grants; combined
roles in different workspaces; signed-in caller with no grants; and revoked access.

- Exercise single prod, test/prod, dev/test/stg/prod and allowed flexible multi-target
  workflows, draft-only publishing, exact-version promotion and rollback.
- Prove an editor cannot prod-release through a direct API, crafted batch or stale
  wizard; an approver cannot publish a draft; role scopes in workspace A cannot
  authorize a form in workspace B; the second-person publisher cannot self-release.
- Test a denied second target, grant revocation, workflow revision change, concurrent
  draft edit, release/intake changes and outbox failure: no partial version/release
  writes. Test timeout/retry and repeated confirmation: no duplicate snapshot/events.
- Test Operations-only and Workspaces-only landing, unauthorized deep links, exits,
  in-mode account settings, read-only form review and installation-only global logs.
- Verify response-only discovery exposes no drafts/unrelated metadata or counts;
  erase-only does not gain read/export; global queue readers do not gain retries.
- Verify filters leave header/heading unchanged, state survives back/refresh/detail
  routes, and explicit env selection cannot be overridden by a stale preference.
- Verify Available in reflects current releases after replacement/rollback, intake
  stays closed, sessions remain pinned and actual test/prod links reach the correct
  runtime. Include Docker-origin link coverage in the existing CI E2E suite.
- Preserve preview, Rules/step editing, question reuse, per-form delivery history,
  membership self-grant protection, security settings and existing account flows.
- Check keyboard/focus/dialog behavior, accessible names, zoom/reflow and existing
  themes using production components. Do not assert pixel parity with this POC.

For implementation, run repository-required verification and targeted API/database
coverage, plus the detached browser gate and Docker E2E when applicable. Follow
[contributing](../CONTRIBUTING.md) and current application instructions for exact
commands and allocated ports. Headed Playwright with one-second actions is a local
inspection option, not a CI default.

Update user-facing publishing/navigation documentation, environment capability
docs, release/workspace ADRs, security matrix, API schema and scaffold templates in
the corresponding implementation phases. Keep the POC labeled as guidance after
shipping; reconcile discrepancies with approved flow contracts, not its styling.
