---
"create-qcms-app": patch
---

Build the scaffolded assistant's action arguments from the API's own route schemas.

Each action kind's argument schema is now derived from the Zod request body its route
publishes, so a route that gains a member, tightens a limit or names an enum reaches the
model or fails the type check. The scaffolded assistant therefore offers the installation's
own access-group role names, the environment name pattern and an address format where it
previously offered loose strings, and `pnpm check:agent-step-args` holds the scaffolded
admin's step runners to the same argument set (issue #1306).
