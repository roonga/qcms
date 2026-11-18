HANDOFF: BLOCKED host disk full (C: 0 GB free); the WSL checkout returns I/O errors, so the browser gate and up:e2e could not finish

- Done and pushed: Site configuration mode and rail, Accounts list, New account, account page with resend, reset, disable (step-up for a Site administrator), reactivate; GET /admin/accounts/{id}; accounts.pw.ts (7/7 green run alone on seat 9); pnpm verify green; forced turbo test green apart from one Testcontainers start timeout in an untouched db suite, green on retry.
- Remaining: QCMS_PORT_SEAT=<seat> pnpm verify:browser:detached then verify:browser:wait until it stops exiting 75; QCMS_PORT_SEAT=<seat> pnpm up:e2e (full-stack account creation through Mailpit); open the PR.
- Delete this file in the commit that resumes the work.