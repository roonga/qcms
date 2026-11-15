HANDOFF: AWAITING-HUMAN Code Owner review of design batch 1, the glossary on the existing artboards, before task 104's admin UI relabelling lands

## Why this is parked

- Task 104's deliverable is the labels of `docs/WORKSPACE_ACCESS.md` section 2 across `apps/admin/lib/i18n/en.ts`, `apps/admin/components/` and the admin docs.
- Its design gate is batch 1, the glossary on the existing artboards.
- `docs/WORKSPACE_ACCESS.md` section 12 records a Code Owner review of design batch 6 alone and states that no admin UI task starts until the Code Owner has seen its boards. `plan/work-order-sequence.md` repeats it for the DG column.
- `plan/design-sync-workspace-access-v3.md` says the glossary sweep exists on the canvas, so the boards are there to look at. The review of them is what is missing.
- No batch 1 approval is recorded, and an approval is never assumed, so the relabelling is not written here.

## What this branch does carry

Copy corrections left over from the 094 review. Each one fixes an inaccuracy rather than applying the glossary, so none of them depends on batch 1.

- `forms.publish.blocked.draftNotAllowedOnly` names the Site administrator, who alone writes the publishing workflow.
- `membership.role.formsViewer.description` says publish history, not releases, and joins the `publish-wording.test.ts` guard.
- `membership.settings.twoPersonHelp` says the other administrator has to make the change, matching the API refusal in `apps/api/src/features/membership/handler.ts`.
- `docs/environment-capabilities.md` gives the version freeze to an editor with a publisher, because `form: publish` is the publisher's cell in `apps/api/src/features/membership/policy.ts`.

## What task 104 still owes

In `apps/admin/lib/i18n/en.ts`:

- `membership.role.formsViewer.name`, `formsEditor.name`, `formsPublisher.name`, `responsesViewer.name`, `responsesEraser.name` and their descriptions, to View forms, Edit forms, Publish forms, View responses and Erase responses.
- `membership.role.formsOwner.name`, `membership.members.ownerRole`, `membership.members.makeOwner` and `membership.members.removeOwner`, to Workspace administrator.
- `membership.groups.columnHolders` and the holder strings, to People in this group.
- `membership.members.intro` and `membership.mine.installationAdmin`, which still say installation-wide claim rather than Site administrator.
- The Members, Approver, Grant and Revoke labels, which already read as the glossary asks and need a check rather than an edit.

Elsewhere:

- `apps/admin/components/membership/access-groups-panel.tsx` and the unit tests beside it, `apps/admin/lib/membership/access-group-form.test.ts`, and the `apps/admin/e2e` specs that assert the old role names.
- The admin docs listed by the work order.
- The dead-key check and the exit criterion that no label from the glossary's Replaces column remains.
- The 104 row in `docs/features/README.md`, left untouched here.

## Also found, not fixed

- `apps/api/src/features/membership/handler.ts:117` still says "installation administrator" in a refusal a person reads. It is outside this work order's named areas and overlaps the open PR for task 088.
