# Environment navigation POC

Status: interactive design proposal; no application or backend policy changes.

Open [the POC](environment-navigation-poc.html) through `pnpm artifacts`. It uses
the artifacts service's allocated port in [PORTS.md](../../docs/PORTS.md).

## Explore

- **Forms:** open Customer onboarding. Edit the shared draft, preview it, then
  publish a version alone or publish to the first configured environment.
- **Versions:** review immutable sample snapshots. Later draft edits do not change
  their content.
- **Releases:** see every environment's released version and intake status. Review
  a candidate and destination before release, or select an older version for rollback.
- **Operations:** choose an environment and form. Explore intake, responses,
  secure links and webhooks. The URL retains the current operational context.
- **Administration:** try production only, test/production, four stages or flexible
  destinations. Customize the names, order and protected production destination.
  Toggle preceding-environment eligibility and a different production approver.
- **Explore as:** simulate an editor, approver, response operator or site owner.
  Full access combines those roles for easier exploration; ownership alone grants
  only the administration view.

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

- Chromium journeys: shared draft continuity, immutable versions, publication,
  four-stage promotion, single-environment publication and flexible destinations.
- Chromium journeys: rollback, role separation, second-person release, environment
  and form context, secure-link isolation, revocation and endpoint approval.
- Desktop and mobile accessibility scans, release-dialog scan, keyboard dismissal,
  browser refresh context and mobile overflow checks.
