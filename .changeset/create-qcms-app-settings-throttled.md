---
"create-qcms-app": patch
---

Re-sync the scaffolding templates with the admin's Settings screen, which now reports a
throttled password change or recovery-code regeneration as a throttle rather than as a
wrong password (issue #845).

A scaffolded admin inherits both Settings handlers, and each read only "did the auth
mount refuse", so a `429` arrived at the screen as "those details did not match". SEC-1
throttles `/change-password` in the sign-in limiter and the recovery-codes call sits in
the `/two-factor/*` bucket, so an operator can meet the refusal without having got
anything wrong, and the advice that message carries is the one action that keeps the
window shut. The templates now carry the status check on both handlers, a second marker
pair for the recovery-codes form (both of that screen's forms land back on `/settings`,
so one pair would print a refusal under the wrong form), and the shared
marker-to-sentence mapping in `lib/auth-failure-message.ts`. No new copy string.
