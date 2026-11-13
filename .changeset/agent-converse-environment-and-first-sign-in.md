---
"create-qcms-app": patch
---

`pnpm agent:converse` can now reach an operational card and finish a fresh stack's first sign-in.

`--environment <name>` sets the environment switcher's cookie after sign-in and before the
first navigation, so a run can exercise test links, webhooks and the open and closed state,
which belong to one environment. A script file takes `environment` beside `formId`, and
`QCMS_AGENT_CONVERSE_ENVIRONMENT` is read when neither names one. The name is checked against
the admin's own vocabulary so a typo is refused rather than falling back to prod.

An account still holding its provisional password was refused and sent to a browser. The run
now completes the forced password change itself when `QCMS_AGENT_CONVERSE_NEW_PASSWORD` names
the password to set, as an environment variable rather than a flag for the same reason the
first password is.
