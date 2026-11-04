---
"create-qcms-app": patch
---

Mirror the saved-draft binding into the scaffolded apps: the proposal token carries the
draft revision its pin-checked steps were built from, and every step of such a plan is
refused once that draft moves (issue #1205 follow-up).
