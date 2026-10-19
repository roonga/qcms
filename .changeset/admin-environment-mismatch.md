---
"create-qcms-app": patch
---

An admin confirmation can no longer act in an environment other than the one it names
(local UX list A1), and the screen and the API resolve one environment per request
(local UX list A12).

The environment selection is a cookie every tab shares, and the switcher refreshes only
its own tab. Environment-sensitive server actions read the cookie when they ran, while
their dialogs printed the environment they were rendered with, so a tab showing "Close it
in prod" closed the form in `test` after a second tab switched. Every action that acts in
one environment (close and reopen, publish and release, mint and revoke links, erase and
release a flagged response, the webhook endpoint actions and redelivery) now takes the
environment its page rendered and refuses, sending nothing, when the request resolves to a
different one: "This tab was showing prod; you have since switched to test. Nothing was
changed. Reload to continue." The refusal is shown inside the dialog that was confirmed. A
tab that becomes visible again under a changed cookie is also re-read, and the switcher
now follows the re-read selection instead of keeping the name it was mounted with. The
environment stays out of admin URLs.

The API header used to carry the raw cookie while the shell validated it and fell back to
`prod`. Both now read one resolution, so a stale selection is `prod` in the chrome and on
the wire alike. When the environment set cannot be read, the shell says the environment is
unknown instead of presenting `prod`, and environment-sensitive controls are disabled.
