---
"create-qcms-app": patch
---

Close the builder programme: the docs, the cross-stack journey and the acceptance tests
(task 121, criteria 117 and 123).

- The admin reads `QCMS_FLAG_THEME_DERIVE`, which only the API read before, so the appearance
  drawer offers no "From your website" row where the derive route is unmounted. The workspace
  theme save, which is not behind that flag, stays. Compose, the admin example file, the
  scaffold template and the operator table carry the variable.
- Criterion 117: with second approval on and `prod` the only environment, an appearance-only
  change after a draft publish was requested lapses the approval, as a question change does.
- Criterion 123: a Move form carries the form's appearance by value; a lock in the destination
  refuses the appearance edit that follows and not the move; the Move form confirmation says so.
- A Playwright journey across both stacks: a look set in the builder drawer, published through
  the wizard, read off the respondent's own page in the portal.
- One X4 sweep walks every builder fact, tool and action kind from its own registry, so a new
  one lands uncovered and fails.
- `docs/theming.md`, `docs/operations.md`, `docs/deploy-enterprise.md`,
  `docs/agent-authoring.md` and `apps/portal/README.md` describe what shipped: the appearance
  drawer, workspace themes and the lock, the SEC-18 flag with its egress allowlist and proxy,
  the agent builder, card-less draft edits with Undo, and per-form appearance with the
  respondent's own controls.
