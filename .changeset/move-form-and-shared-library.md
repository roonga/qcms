---
"create-qcms-app": minor
"@roonga/qcms-db": minor
---

Move form and the shared question library screen (task 095).

- A move needs Edit forms in the source and in the destination. It applies at once for an
  active Workspace administrator of the source with second approval off there; every other
  move, and every move at all while the rule is on, is held as a workspace approval request
  in the source and applied when a Workspace administrator of it or a Site administrator who
  is not the mover approves it. The Workspace administrator cell is no longer a route-policy
  row, which is what lets a holder of Edit forms in both workspaces ask for the move.
- The approval is re-checked as it is applied: a mover who has lost Edit forms in either
  workspace, a destination archived since the request, or a form that has left the source
  applies nothing and ends the request as `lapsed`. A move writes one `setting` row in each
  workspace's audit, and a move to the form's own workspace is refused.
- `moveFormToWorkspace` in `@roonga/qcms-db` now takes `{ from, to }` and updates nothing
  when the form is no longer in `from`.
- `GET /admin/forms/{id}/workspace/preview` answers who gains and who loses which acts, from
  the two workspaces' groups through the same policy evaluator as the screens, and whether
  the move needs an approver. Each person is named by display name, or by email address
  where the name is blank, and by nothing else.
- `PUT /admin/workspaces/{id}/shared` takes `handOn: true` to unmark the current holder in
  the same transaction. Marking or unmarking the shared question library writes a `library` site audit row
  mirrored into that workspace's audit, and question lists carry a Shared tag for the rows
  that library owns.
- New screens: Move form on the form rail, drawn where the caller holds Edit forms in
  another workspace, and Shared question library in Site configuration.
