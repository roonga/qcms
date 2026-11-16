---
"create-qcms-app": patch
---

Add the scaffolded admin's agent builder shell, behind the agent flag.

- Routes `/forms/[formId]/build` and `/forms/new/build`, entered from the New form screen and a form's menu, and 404 with the flag off.
- A focused mode with its own top bar group and Exit, no rail and no dock, and the assistant pane and preview as two tabs below 64rem.
- The builder's own tab-only conversation store, and a publish wizard `returnTo` limited to the same form's build screen.
