HANDOFF: AWAITING-HUMAN Code Owner confirmation of the design batch approvals, recorded in `docs/WORKSPACE_ACCESS.md` section 12, before task 104 lands

## Why this is still parked

- `docs/WORKSPACE_ACCESS.md` section 12 records a Code Owner review of design batch 6 alone and states that no admin UI task starts until the Code Owner has seen its boards. `plan/work-order-sequence.md` repeats it for the DG column.
- Task 104's design gate is batch 1, the glossary on the existing artboards.
- An approval reached this branch only through agent chat, which is never the Code Owner's own word. No approval is recorded here, and none is assumed.
- The section 12 entry, the ledger row in `docs/features/README.md` and the pull request are therefore not written. They are the Code Owner's to confirm or to land.

## What this branch carries

The sweep itself, which is copy only and reversible.

- The five role names in `apps/admin/lib/i18n/en.ts` read View forms, Edit forms, Publish forms, View responses and Erase responses.
- Workspace owner reads Workspace administrator on the role name, the member row and its two buttons.
- The access group column reads People in this group, and the strings beside it no longer say holder.
- My access, the Members help and the empty-state copy name the Site administrator instead of the installation-wide claim.
- The second-approval switch, the assistant cards and the endpoint approval panel say Second approval and Approver.
- `apps/api/src/features/membership/handler.ts` names a Workspace administrator and a Site administrator in the self-grant refusal.
- `apps/admin/lib/i18n/access-wording.test.ts` guards the glossary's "Replaces" column against the access copy.
- `docs/environment-capabilities.md` gives the atomic publish an editor with a publisher, because `release: create` is the publisher's cell in `apps/api/src/features/membership/policy.ts`.

## What remains

- Record the design batch approvals in `docs/WORKSPACE_ACCESS.md` section 12, in the style of the batch 6 entry.
- Set the 104 row in `docs/features/README.md` to `done (PR #NNNN)`.
- Open the pull request and delete this file.

## Also found, not fixed

- `apps/api/src/features/membership/handler.ts` still says "installation administrator" in the `cannotAdd` refusal, and `lastOwner` still reads as an owner. PR #1282 (task 089) rewrites `lastOwner` to `lastAdministrator` in that file, so both are left to it.
- `docs/environment-capabilities.md` describes the roles as built, in the old vocabulary, by its own statement. It is not an admin doc and was left alone apart from the capability row.
