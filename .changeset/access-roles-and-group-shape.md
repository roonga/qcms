---
"@roonga/qcms-db": minor
"create-qcms-app": minor
---

Task 085: five access roles, and an access group that carries a set of roles and one
explicit environment set.

`control.team` loses `role` and `forms` and gains `roles text[]`; `control.organization`
loses `seedNewEditorsWithTestData`. Migration 0008 deletes every stored access group first:
QCMS is green field for this model, the old role vocabulary has no mapping onto the new one,
and the delete is what lets `roles` be added `NOT NULL`. `teamMember` cascades, so an
administrator grants the new groups again after the upgrade.

What an adopter should know.

- The roles are `forms.viewer`, `forms.editor`, `forms.publisher`, `responses.viewer` and
  `responses.eraser`. `forms.approver` is gone and `forms.publisher` carries its acts;
  `forms.owner` survives only as the `member` row's Workspace administrator flag and is
  refused on a group.
- A group holds several roles at once, so one group can be an author's whole grant. Roles
  are additive across groups.
- There is **no value meaning every environment**. A group carrying `forms.publisher`,
  `responses.viewer` or `responses.eraser` names at least one environment; a group carrying
  only `forms.viewer` or `forms.editor` names none, and those two apply everywhere. An
  environment added later is covered by no group until an administrator adds it to one.
- There is **no form scope**: the workspace is the only access zone, and a group that names
  forms is refused.
- A group's name is a label an administrator chooses, unique within its workspace. The
  `<environments>.<role>[.<label>]` grammar is withdrawn and nothing parses a name.
- Freezing a version takes `forms.editor` **and** `forms.publisher`: `POST /forms/{id}/publish`,
  `/publish-and-release` and `/publish-batch` each require both cells, and the publisher's
  environment set decides which destinations a release reaches.
- `POST /admin/questions/{id}/workspace` is removed: questions do not move between
  workspaces, and the shared question library covers reuse.
- `PUT /admin/workspaces/{id}/settings` now takes `{ requireSecondApprover }` alone, and the
  seed-new-editors setting is gone from the route, the list and the screens.
- `GET /admin/workspaces` admits every grant holder. A caller who administers nothing in a
  workspace is given its identity alone, with no shared-library flag, no second-approval
  setting and no form or question counts.
