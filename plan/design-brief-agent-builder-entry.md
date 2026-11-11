# Design brief: agent builder entry and mode chrome

## Problem

The agent builder is a new screen where the assistant authors a form next to a live preview. Nothing yet says how a user gets in, what the screen looks like as a mode, or what an empty new form looks like. Rulings are in Q13 of `plan/agent-builder-decisions.md`.

## Ask

Design the two entry points and the mode chrome, reusing existing admin patterns.

## Decisions needed

- New form screen: how "Start blank" and "Build with the assistant" are offered (two cards, a segmented choice or two buttons), which is the default, and the copy.
- Form menu: where "Edit with the agent builder" sits among the existing entries, its icon (if any) and its behaviour when the form has no open draft ("Start a new draft" first).
- Mode chrome: the top bar group with the title "Agent builder", the form name (or "New form") and Exit, and the heading row with Edit by hand, Share preview and Publish.
- Empty new-form state: the assistant pane's first prompt and suggestions, and the preview before any step is confirmed (Share preview and Publish disabled, with the reason).
- Phone: the assistant pane and the preview as two tabs below 64rem, and where the heading row actions go.

## Constraints

- Admin only. Both entries sit behind the agent flag. Flag off: neither entry exists and the route is 404.
- No top bar start screen and no standalone top bar entry.
- The builder is a parallel mode like Operations. The docked assistant does not render in it and the standard assistant is unchanged.
- No rail and no breadcrumb row. Exit returns to where the user entered (the form or the New form screen). Edit by hand goes to the form.
- No environment selector: authoring ignores the environment.
- An existing form edits the open draft only, never a released version.
- Reuse the Rail, Topbar and Operations group styles and tokens. Add none unless needed, and say so.
- Keyboard order, focus after Exit, and names that contain their visible text (WCAG 2.5.3).

## Deliver

- Desktop and phone mockups of the New form choice, the form menu entry, the empty new-form builder and a builder on an existing draft.
- All four themes (light, dark, hc, hc-dark), plus the flag-off state of both entry points.
- Update the QCMS design system artifact in the same pass.
