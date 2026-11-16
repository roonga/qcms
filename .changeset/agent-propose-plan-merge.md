---
"create-qcms-app": patch
---

Merge the scaffolded assistant's `propose_action` into `propose_plan` (issue #1305).

- A single act is now a one-step plan. `propose_action` is gone from the tool set, and so
  is the `action` turn event an adopter's own client may read.
- The tool payload the model is sent falls from about 145,000 to about 65,000 characters
  over 26 tools.
