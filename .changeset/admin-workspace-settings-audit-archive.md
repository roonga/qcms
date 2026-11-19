---
"create-qcms-app": patch
---

Add the Workspace area's Settings, Audit requests and Archive screens (task 099).

- Settings renames the workspace, says the stored identifier cannot change, and reports every second-approval state: the refusal to turn it on where nobody else could approve, the warning while it is on and nobody else could approve, a switch-off waiting for an Approver, and how the last one ended, `lapsed` included.
- The Audit screen carries the Requests row for this workspace's held acts, with Approve and Reject for anybody but the person who asked, labels for the stored kinds the audit gained, a "From Site audit" tag on a mirrored account act, Act and Person filters in the rail, and a pager.
- Archive is a screen of its own, a rail row from two workspaces, refusing inline while the workspace owns a form or holds the shared question library and otherwise gated on the workspace name typed exactly.
