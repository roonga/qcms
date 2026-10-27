# Environment navigation POC

Status: interactive design proposal; no application or backend policy changes.

Open [the POC](environment-navigation-poc.html) through `pnpm artifacts`. It uses
the artifacts service's allocated port in [PORTS.md](../../docs/PORTS.md).

## Explore

- **Application navigation:** Questions, Forms, permitted Workspaces,
  Operations and permitted Site configuration live in the top bar. There is no
  Authoring menu group. [Existing-nav coverage](top-nav-reconciliation.md) maps
  every shipped entry and header utility to its POC destination and preview limits.
  Operations has a separated entry after the normal menus, with a divider and
  additional spacing. The account uses an avatar with an accessible name. There
  is no workspace scope label or workspace switcher in the application header.
- **Context rail:** contains only navigation within the selected context. A form
  has Draft and Versions; the sample question has Question details and Used by;
  A selected operational form has its permitted screens and an All forms return link.
  Form listing screens have no rail.
  Context links are not duplicated as content tabs or application-level rail items.
- **Forms:** open Customer onboarding. Edit the shared draft, preview it, then use
  the single **Publish** button to start the publishing wizard.
- **Versions:** the combined version and release view. Review immutable snapshots,
  current environment availability, intake state and release history in one place.
  Every table row has the same Review action; no variable next-action column.
- **Publish wizard:** choose the draft or an existing version, choose an accessible
  destination, review the change, then confirm. Destinations outside the caller's
  permissions are omitted. Accessible destinations blocked by the configured flow,
  second-person rule or current release state are shown with an explanation.
- **Multiple destinations:** the site owner can enable publishing to several
  environments in one confirmation. Flexible flow enables this by default; the
  other presets use one destination. Each selected environment must independently
  meet its prerequisites before confirmation. Selecting an earlier stage in the
  same batch does not qualify a later stage.
- **Publish without releasing:** within the wizard, a draft may become an immutable
  version for an approver to release later. This also supports a prod-only site that
  requires separate publishing and releasing accounts.
- **Operations:** enter a dedicated mode from the top-level application menu.
  The normal application menu and authoring navigation disappear. Only the
  environment selector remains in the Operations top bar; there is no form dropdown.
  Entry opens a forms table with search, workspace/intake filters, sorting and
  pagination. Select a row to open that form's operational screens.
- **Operations forms list:** 32 synthetic forms across four sample workspaces
  demonstrate a larger installation. Columns show workspace, released version,
  intake state, permitted response counts and last release. Search matches name or
  ID. Filters, sort and pagination are preserved in the URL through detail pages,
  refresh and the All forms return link. Changing environment resets pagination.
  The sidebar contains Overview, Responses, Links and Webhooks only after a form
  is selected. Unreleased forms have no enabled intake or secure-link creation.
- **Filter boundaries:** search, workspace, intake and sort affect only list
  results. They do not change the application header or the page heading above the
  filter controls. Environment is an explicit Operations-wide context. List filters
  do not apply to Delivery failures or Erasure log; returning to Forms restores them.
- **Environment-wide operations:** Delivery failures and Erasure log remain
  independent of the selected form. Their own Operations menu preserves the
  existing global queue and evidence screens. Sample retries affect one environment.
- **Workspace management:** only workspace owners and installation administrators
  see the Workspaces entry. It opens a separate mode, hiding the normal app menu.
  Owners see only workspaces they manage. Members, access groups, settings and audit
  stay in the selected workspace's rail. All workspaces returns to the managed list.
  Exit workspaces restores a permitted normal area. The workspace-only owner
  persona opens directly in this mode without an exit into inaccessible areas.
- **Personal access and Settings:** every user can review My access under the avatar,
  without a Workspaces management menu. Personal Settings remains available inside
  both focused modes without showing normal menus.
  Personal Settings is under the avatar, with Account, Change password and Two-factor sections; it does
  not contain workspace or release-flow controls. These are navigation previews.
- **Avatar:** contains Settings, identity, personal security entry points and simulated
  sign-out. Operations-only users can open account settings without exposing the
  normal app menu. Appearance keeps its existing place as a header utility; this
  POC demonstrates the Light layout only.
- **Exit operations:** returns users with other permissions to their previous
  authoring or administration context. Re-entering Operations opens the forms list
  in its previous environment, preserving its filters. No authoring links are shown
  inside Operations.
- **Operations-only users:** the response-operator persona opens directly in
  Operations, with no normal application menu or exit into an inaccessible area.
  Only its permitted operational screens are shown, including when an authoring
  bookmark is supplied.
- **Administration:** try production only, test/production, four stages or flexible
  destinations. Customize the names, order and protected production destination.
  Toggle preceding-environment eligibility, multiple destinations and a different
  production approver.
- **Explore as:** simulate an editor, approver, response operator or site owner.
  Full access combines those roles for easier exploration; ownership alone grants
  only the administration view. The test-only editor demonstrates destination
  filtering by environment scope.
  Jordan is a workspace-only owner of Customer experience, with no authoring,
  response or installation-administration privileges.

The Versions table's **Available in** column names environments currently serving
that version, not every environment that ever served it. Publishing a replacement
or rolling back updates the badges; prior releases remain in the release history.
The wizard never writes a version or release before its final confirmation.
For a batch, review shows each environment's version replacement and intake state.
All destinations are checked before any changes; a draft creates one immutable
version reused by the entire batch. If a destination changes during review, no
version or release is written until the refreshed review is confirmed. Creating a
version for later release is exclusive with environment selection.

For the second-person journey, enable the requirement in Administration, publish a
new version as Alex, release through the configured non-production stages, then
switch to Morgan to release to production. A production webhook change similarly
requires a different account to confirm its pending proposal.

## Boundaries

- All content and operations are browser-memory simulations. Reloading or resetting
  restores the initial four-environment sample. Applying a flow resets sample data.
- Sample links do not open a respondent session. Response export downloads synthetic
  data only. No application APIs, production records or webhook endpoints are called.
- Ordered and flexible release rules illustrate owner-configurable policy. The
  running API's existing eligibility rules remain unchanged.
- Batch publication is a browser-memory concept. A production implementation needs
  backend support to authorize and validate every target and commit the batch
  atomically; this POC does not provide that API.
- Role simulation demonstrates navigation and action permissions. It does not
  implement authentication, workspace switching or a complete grant-scope editor.
- Customer onboarding is the interactive authoring example. Additional forms and
  all workspace names are synthetic Operations-list data, not live installation
  records. The list illustrates access to several workspaces; it does not implement
  workspace provisioning or a complete permission-scope editor.
- Questions opens the Contact email example to demonstrate question-specific rail
  navigation; this POC does not reproduce the full question library.

The proposal follows the
[independent UX recommendation](../environment-ux-recommendation.md) and
[capability brief](../../docs/environment-capabilities.md). The owner-configurable
flow illustrates the subsequent product direction; it does not amend an ADR.

## Validation

- Chromium journeys: wizard cancellation, shared draft continuity, immutable versions,
  publication, four-stage promotion, single-environment publication, flexible
  destinations and current availability after replacement or rollback.
- Chromium journeys: rollback, role separation, second-person release, environment
  and form context, secure-link isolation, revocation and endpoint approval.
- Chromium journeys: multiple destinations, exclusive version-only publication,
  selection continuity, batch cancellation, current-version revalidation and
  prevention of prerequisite bypass or partial batch updates.
- Desktop and mobile accessibility scans, wizard-step scans, keyboard dismissal,
  browser refresh context and mobile overflow checks.
- Chromium journeys: dedicated Operations navigation, top-bar context selectors,
  exit/re-entry, role-filtered menus and Operations-only entry/bookmarks.
- Chromium journeys: application-level Questions/Forms navigation, active top-nav
  state on nested screens, context-only rails and no duplicate form navigation.
- Chromium journeys: forms search, workspace/intake filters, sorting, pagination,
  empty results, list/detail/refresh continuity, environment scope, unreleased forms
  and response-data visibility; desktop and mobile listing accessibility.
- Chromium journeys: shipped top-nav coverage, workspace permission separation,
  personal-settings navigation, account access inside Operations, environment-wide
  failure retries and erasure evidence.
- Chromium journeys: owner-scoped workspace mode, direct-route permission checks,
  mode exit/restoration, workspace-only entry and stable headers during list filtering.
