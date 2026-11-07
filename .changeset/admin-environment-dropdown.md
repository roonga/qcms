---
"@roonga/qcms-ui": minor
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Clean up the admin: one top bar toolbar, a workspace switcher, and lists scoped to a workspace.

- `@roonga/qcms-ui/kit` exports `MenuItemText`, the stack's own label and description slots
  for a menu row, so a row that names a known value keeps that value as its accessible name.
- The environment selector is a menu: a labelled trigger holding the environment chip and a
  caret, then one row per configured environment, each its own chip with a check on the
  current one. Production keeps its own colour and the rest take tints in list order.
- Operations carries the area title, the environment and Exit Operations in one top bar group.
- `listQuestions` returns each question's `workspaceId`, so a library list can be scoped to
  the workspace the operator is working in.
- One `.qcms-envchip` rule serves the bar, its menu and an assistant card.
