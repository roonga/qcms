---
"create-qcms-app": patch
---

Scaffolded apps carry task 069's membership surface: the six roles as disjoint statements,
the grant middleware and the eleven write endpoints, the capability endpoint, the SEC-15
audit writes, and the `/workspaces` screens with the access-group and settings panels.

Two scaffolding consequences are worth stating, because a scaffolded installation meets
both on its first run.

**An authenticated admin session is necessary and not sufficient.** The installation-wide
claim administers settings, accounts, memberships and environments and authorises no
authoring and no response read anywhere, and `forms.owner` touches no form, release, link,
webhook or response row at all. So `qcms:create-admin` now seeds the first administrator's
`all.forms.editor` and `all.forms.approver` access groups, and a bootstrapped installation
authors exactly as it did before. No `responses.*` grant is seeded: reading response data
is a deliberate act somebody performs and the audit records.

**The seed setting's help text is a control rather than copy.** A grant on `test` responses
is a grant on personal data, because a test run can involve real respondents, and the
workspace settings panel says so beside the switch and before anybody turns it on.
