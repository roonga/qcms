---
"create-qcms-app": minor
---

The Workspaces area reads in plain words, and an installation with one workspace stops seeing the machinery of several.

- The "Workspace: {name}" line is gone: the breadcrumb and the switcher already name it.
- At one workspace the area is "Workspace", the crumb keeps the workspace's name, the rail
  offers no way back to a list, and `/workspaces/all` lands on that workspace.
- An access group is titled by its role and scope ("Form editor, all environments, all
  forms"). Its stored, full and directory names, the naming grammar and the derived name of a
  new group sit under Advanced. "All environments" and "All forms" are labels again, with the
  rule behind their help.
- The access audit names each act in words rather than printing `grant` or `erasure`.
- Assistant actions reads each step as the act in words, its one detail labelled and resolved
  to a group or person's name, and the screen it reached by that screen's name. Steps are
  grouped under the plan they ran in, the step column is gone, and the screen states that
  every row is a step a person confirmed and that then succeeded.
- A member with no access group reads "No access".
