# Design brief: workspace context and switching

## Problem

Forms and questions each belong to one workspace, but nothing in the shell says which workspace you are working in, and there is no single way to change it.

- Questions and Forms list every workspace together. Their rails and breadcrumbs never name a workspace.
- Operations groups forms by workspace in its rail, and a group header filters the list.
- Workspaces uses an accordion, one group per workspace.
- The shell remembers the last workspace in a cookie, but no control shows or changes it.
- Most installations have one workspace. The design must cost nothing then.

## Ask

Design how the current workspace is shown and switched when an installation has more than one, across Questions, Forms, Operations and Workspaces.

## Decisions needed

1. **Scope:** do Questions and Forms show one workspace at a time, or all with a workspace filter?
2. **Where it shows:** top bar, rail header, or breadcrumb root (for example `Workspace / Form / Section`).
3. **How to switch:** a menu in the same slot as the environment control, a rail control, or a breadcrumb dropdown. Say where the switch lives on each of the four areas.
4. **Single workspace:** nothing is drawn, no name, no control.
5. **Operations:** its rail already groups forms by workspace. Say how that fits with a switcher, so the same choice is not offered twice.
6. **After a switch:** where you land (the same section in the new workspace, or the area's list).
7. **Remembered choice:** the last workspace is kept per browser. Say what a fresh browser sees first.

## Constraints

- Admin only. Top bar is sticky, with the Operations group (title, environment, divider, Exit) already in it.
- Workspaces are few, usually 1 to 5, rarely more. Names can be long.
- A workspace is a real access boundary, so the current one must be unmistakable and never colour-coded (colour is reserved for environments).
- Keyboard and screen reader: a labelled menu, a check on the current item, name contains visible text.
- Phone width and all four themes (light, dark, hc, hc-dark).
- Selected-row rail style, no repeated page title, and no long help text (behind a `?` hover if needed).

## Deliver

- Desktop and phone mockups for Questions, Forms, Operations, Workspaces, with one workspace and with three.
- The switcher closed, open, and with a long name.
- A ruling on each decision above.
- Update the QCMS design system artifact in the same pass.
