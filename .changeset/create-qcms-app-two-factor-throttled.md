---
"create-qcms-app": patch
---

Re-sync the scaffolding templates with the admin's auth screens, which now report a
throttled second-factor attempt as a throttle rather than as a wrong code (issue #805).

A scaffolded admin inherits the three two-factor verify handlers, and each of them read
only "did the auth mount refuse", so a `429` from the shared `/two-factor/*` bucket
arrived at the screen as "those details did not match". The advice that message carries
is "type it again", which is the one action that keeps a throttle window shut, so the
copy worked against the person reading it. The templates now carry the sign-in handler's
status check, the shared marker-to-sentence mapping in `lib/auth-failure-message.ts`, and
no new copy string.
