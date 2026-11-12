# 113 - Builder shell, routes and conversation store

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 106, 085, 094; the builder shell on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (U1, Q1, Q12, Q13, Q16, Q17, "Required tests": Authorisation, Flag off, `returnTo`) · `plan/admin-design-contracts.md` section 7 (the builder exception, 106) · `apps/admin/lib/agent/panel.ts` · `plan/work-order-sequence.md`

## Context

The builder is a parallel mode, like Operations. It does not change the docked assistant, the manual builder or the publish flow. This task builds the frame every other builder UI task fills.

## Deliverables

- Routes `/forms/[formId]/build` (the form's open draft; with no open draft, "Start a new draft" first) and `/forms/new/build` (no form id until the first confirmed step, 115). Flag off: both 404 and both entries absent.
- Two entries: the New form screen offers "Start blank" or "Build with the assistant"; a form's menu gets "Edit with the agent builder". No top bar entry.
- Mode chrome: a top bar group titled "Agent builder" with the form name (or "New form") and Exit; no rail, no breadcrumb row; heading row with Edit by hand, Share preview (the authenticated admin preview route, Q12) and Publish (opens the wizard). Below 64rem the assistant pane and the preview are two tabs. Exit returns to the entry point; Edit by hand goes to `/forms/<id>`. No environment selector.
- The builder's own conversation store: `sessionStorage` only, its own key bound to the user and keyed by workspace and form, cleared at sign-out with the dock's; no server persistence (Q17). The dock does not render in the mode.
- The publish wizard's `returnTo`, validated server-side (in the admin server) against `/forms/<id>/build` for the same form only; anything else falls back to the form page.
- Panel widths and the one-rail exception per 106's recorded exception; `modes.ts` gains the builder mode.
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none.

- A View forms holder reaches no tools: `/build` is 404 or renders with no tools, as the design settles.

## Required tests

- Authorisation (X3, U1): a View forms holder gets 404 or no tools on `/build`; a user of another workspace gets 404.
- Flag off: both build routes 404 and both entries absent.
- `returnTo`: an absolute URL, a protocol-relative URL, another form's id, encoded slashes (`%2F`, `%5C`) and any path other than `/forms/<id>/build` are refused.
- Store: the key differs per user, workspace and form; sign-out clears it; nothing is written to `localStorage` or the server.
- Playwright (X3): enter from each entry, Exit returns to it, Edit by hand, two tabs below 64rem, the dock absent in the mode, axe clean.

## Files and areas

`apps/admin/app/(shell)/forms/[formId]/build/` and `apps/admin/app/(shell)/forms/new/build/` (new), `apps/admin/app/(shell)/forms/new/`, `apps/admin/app/(shell)/forms/[formId]/{page.tsx,publish/}`, `apps/admin/components/forms/publish-wizard.tsx`, `apps/admin/lib/shell/modes.ts`, `apps/admin/components/admin-nav.tsx`, `apps/admin/components/shell/shell-chrome.tsx`, `apps/admin/lib/agent/{panel,conversation,conversation-state}.ts*`, `apps/admin/lib/server/shell-route-guards.test.ts`, `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: the builder shell, both entries and the narrow two-tab layout on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

Preview and inspect (114). Create card, edits and Undo (115). The appearance drawer (116).
