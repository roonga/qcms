---
"@roonga/qcms-db": minor
"create-qcms-app": minor
"@roonga/qcms-observability": patch
---

Add Site administrator appointment with step-up and approval requests (task 092).

Migration `0014` adds `control.approval_requests` (site and workspace scope, a per-kind
`payload`, a 7-day window and a decider who is never the requester), `control.step_ups` (a
password and second-factor re-check bound to one session for five minutes) and
`control.suspension_markers`, which replaces the sign-in link history as the record of who
owes a re-confirmation after a reset or a reactivation. `insertApprovalRequest` refuses a
payload that fails its kind's shape, `decideApprovalRequest` and `expireApprovalRequests` move
a request on, and `setSiteAdministrator`, `tryLockSiteAdministrators` and
`listActiveSiteAdministratorIds` back the promote and demote acts. `issuedPendingResetLink` is
removed.

The scaffolded apps gain `POST /admin/step-up`, `POST /admin/accounts/{id}/promote` and
`/demote`, and `GET /admin/approval-requests` with `/approve` and `/reject`. Disabling or
resetting a Site administrator now needs a step-up and, where another one could approve, a
second Site administrator; the retention sweep expires requests past their 7 days. The OTLP log allowlist exports the sweep's `approval requests expired` event.
