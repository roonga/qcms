---
"create-qcms-app": patch
---

Carry the dev-mode CSP and the environment-scoped Operations column into the scaffolded
apps (issue #1191).

The generated admin and portal grant `'unsafe-eval'` to `script-src` when `NODE_ENV` is
`development`, so a scaffolded app's `next dev` Fast Refresh works instead of looping; the
production policy is unchanged. The generated API reports a form's last release in the
environment the request names.
