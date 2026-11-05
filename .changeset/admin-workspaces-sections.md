---
"create-qcms-app": minor
---

Workspaces is a section of the application rather than a mode, each workspace section is its own screen, and the access-group form uses pickers.

- Workspaces keeps the application navigation and has no Exit; Operations is the one mode.
- `/workspaces/{workspaceId}` lands on `/members`, and Members, Access groups, Workspace
  settings, Access audit and Assistant actions are each a screen of their own. The rail
  expands the current workspace's sections in place, with no back link. The assistant's
  workspace screen splits with them, each section offering only its own actions.
- An access group is created from a role picked by its plain name and one-line description,
  environments ticked from the installation's own list, and "All forms" or forms picked by
  name; its name follows from those choices. A grant picks from the workspace's members.
- `GET /admin/forms` names each form's `workspaceId`.
