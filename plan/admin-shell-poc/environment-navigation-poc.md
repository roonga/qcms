# Environment navigation POC

Status: interactive design proposal; no application or backend policy changes.

Open [the POC](environment-navigation-poc.html) through `pnpm artifacts`. It uses
the artifacts service's allocated port in [PORTS.md](../../docs/PORTS.md).

## Explore

- **Forms:** open Customer onboarding. Edit the shared draft, preview it, then use
  the single **Publish** button to start the publishing wizard.
- **Versions:** the combined version and release view. Review immutable snapshots,
  current environment availability, intake state and release history in one place.
  Every table row has the same Review action; no variable next-action column.
- **Publish wizard:** choose the draft or an existing version, choose an accessible
  destination, review the change, then confirm. Destinations outside the caller's
  permissions are omitted. Accessible destinations blocked by the configured flow,
  second-person rule or current release state are shown with an explanation.
- **Publish without releasing:** within the wizard, a draft may become an immutable
  version for an approver to release later. This also supports a prod-only site that
  requires separate publishing and releasing accounts.
- **Operations:** choose an environment and form. Explore intake, responses,
  secure links and webhooks. The URL retains the current operational context.
- **Administration:** try production only, test/production, four stages or flexible
  destinations. Customize the names, order and protected production destination.
  Toggle preceding-environment eligibility and a different production approver.
- **Explore as:** simulate an editor, approver, response operator or site owner.
  Full access combines those roles for easier exploration; ownership alone grants
  only the administration view. The test-only editor demonstrates destination
  filtering by environment scope.

The Versions table's **Available in** column names environments currently serving
that version, not every environment that ever served it. Publishing a replacement
or rolling back updates the badges; prior releases remain in the release history.
The wizard never writes a version or release before its final confirmation.

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
- Role simulation demonstrates navigation and action permissions. It does not
  implement authentication, workspace switching or a complete grant-scope editor.
- Customer onboarding is the interactive authoring example. Customer feedback is a
  second operational context for testing the form selector.

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
- Desktop and mobile accessibility scans, wizard-step scans, keyboard dismissal,
  browser refresh context and mobile overflow checks.
