# Existing top navigation: POC coverage

**Implementation handover:** see the
[flow and permission plan](../environment-navigation-implementation.md).
This POC guides interaction, **not look and feel**. Existing application components
and approved visual contracts govern implementation. Mock permissions are not
policy: global Delivery failures and Erasure log require the installation claim;
response-only form discovery and atomic multi-environment publishing need new
backend contracts. The plan's audit supersedes simplified access descriptions here.

The inventory comes from the shipped
[AdminNav](../../apps/admin/components/admin-nav.tsx) and
[shell layout](<../../apps/admin/app/(shell)/layout.tsx>), not from the earlier POC.
This is a navigation proposal with synthetic data, not functional parity with the
running admin application.

## App-level destinations

| Shipped entry | Existing purpose                                                                    | POC destination                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Questions     | Question library and question authoring                                             | Questions in the normal top nav; the selected sample question has a context rail.                                                                                                             |
| Forms         | Form library, authoring, versions and releases                                      | Forms in the normal top nav; the selected form has Draft and Versions in its rail. The Publish wizard handles destinations.                                                                   |
| Responses     | Pick a form to inspect its responses; access the erasure log                        | Operations → Forms table → selected form → Responses. Operations → Erasure log preserves the environment-wide evidence screen.                                                                |
| Webhooks      | Environment-wide dead-letter queue and access to per-form endpoint configuration    | Operations → Delivery failures, plus Operations → selected form → Webhooks. Sample retry and retry-all stay within the selected environment.                                                  |
| Workspaces    | Managed-workspace list and My access; workspace members, groups, settings and audit | Workspaces entry only for owners/admins. It opens a separate management mode with a scoped workspace list, contextual panels and Exit workspaces. Other users use My access under the avatar. |
| Settings      | Personal account, change password, two-factor authentication and recovery-code flow | Avatar → Settings, with a personal-settings context rail outside focused modes and an in-mode dialog inside Operations or Workspaces. Workspace and release-flow settings are separate.       |

The existing Responses index is a form picker, **not a cross-form answer table**.
The new operational forms table preserves that entry point without inventing a
merged response browser. The existing Webhooks queue is environment-wide, so a
per-form endpoint screen alone would not replace it.

The POC's **Site configuration** entry is an additional owner-only concept for the
proposed configurable release flow. It does not replace Workspaces or personal
Settings.

## Header controls

| Existing control                            | POC treatment                                                                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment switcher and environment banner | Environment selector and data-context badge inside the separate Operations mode; publication destinations are selected explicitly in the wizard. Shared authoring has no implicit environment selection. |
| Appearance menu                             | Header utility remains beside the avatar. Its preview explains the current fixed-light scope; Dark/High-contrast styling is not reproduced by this navigation POC.                                       |
| Account avatar/menu                         | Avatar-only trigger, with identity inside the dialog. Account settings, change-password and sign-out entry points are represented; no credentials are collected and no live session is changed.          |

Workspaces already exist in the application. Customer experience, People operations,
Finance and Compliance are fictional POC workspace names; none was fetched from a
running installation. The Operations workspace filter only filters list results. No workspace scope or
switcher is shown in the application header. Workspaces remain authorization
groupings within the installation.

## Focused-mode access

- Normal app menus remain hidden inside Operations and Workspaces management until
  a permitted user exits the mode.
- Operations-only and workspace-only users have no exit into inaccessible app areas.
- The Workspaces entry requires management access; owners only see their owned
  workspaces, and direct routes to unrelated workspace management are refused.
- Personal account settings and My access remain reachable from the avatar without
  revealing the normal app navigation or leaving Operations.
- Operational views remain role-specific. A response operator does not gain access
  to endpoint configuration or retries merely by entering Operations.

## Preview limits

- Workspace management panels are read-only examples; membership/grant editing and
  workspace provisioning are not implemented in this POC.
- Personal security panels describe the existing flows. Password changes, recovery
  code regeneration, re-enrolment and real sign-out remain the running app's flows.
- Delivery retries and erasure-log rows are environment-scoped sample data. The
  response-detail erasure flow and full delivery history are not reproduced.
- No application routes, APIs, authorization policy or database records changed.

## Source audit

- [Responses index](<../../apps/admin/app/(shell)/responses/page.tsx>)
- [Erasure log](<../../apps/admin/app/(shell)/responses/erasures/page.tsx>)
- [Webhook operations](<../../apps/admin/app/(shell)/webhooks/page.tsx>)
- [Workspaces index](<../../apps/admin/app/(shell)/workspaces/page.tsx>)
- [Workspace management](<../../apps/admin/app/(shell)/workspaces/[workspaceId]/page.tsx>)
- [Personal settings](<../../apps/admin/app/(shell)/settings/page.tsx>)
- [Account menu](../../apps/admin/components/account-menu.tsx)
- [Appearance menu](../../apps/admin/components/appearance-menu.tsx)
