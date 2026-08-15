# HANDOFF: AWAITING-HUMAN review the task 058 screenshot gate in docs/gates/058/

**Task:** 058 - Preview theme island (`docs/features/058-preview-theme-island.md`)
**Branch:** `feat/058-preview-theme-island`, based on `41cea98`
**State:** implementation complete, tree clean, all automated gates green. The only thing
outstanding is the exit-criterion-7 human gate, which a session may not simulate.

## What a session must NOT do with this branch

Re-run the task. Nothing is red and nothing is missing: exit criteria 1-6 and 8 are met and
measured, and criterion 7 is a Code Owner sign-off on committed evidence. Restarting would
re-derive work that is already on the branch.

## Gates run, from this worktree, seat 3

- `pnpm verify` - green. Paired with `pnpm exec turbo run test --force`, which reported
  `0 cached, 16 total` in 1m21s, because a plain `verify` in a worktree replays the main
  checkout's turbo cache and reports `FULL TURBO` without executing a single suite (it did
  exactly that on the first run here).
- `QCMS_PORT_SEAT=3 pnpm verify:browser` - green, 194 passed / 46 skipped in 10.7m.
- Not run, and not required: the Compose suite. Nothing here reaches a Dockerfile,
  `docker-compose.yml`, or a service boundary.

## What the Code Owner is being asked to approve

`docs/gates/058/README.md`, and the ten PNGs beside it (five frames at 390 and 1280).

One frame needs a deliberate decision rather than a glance: **`overlay-open`**. It shows a
date picker's calendar open over a Plum/Dark island, drawn in the authoring app's Cobalt,
because a react-aria popover is portalled to `document.body` and is therefore not a
descendant of the scope carrier. That is the amendment of 2026-08-14's accepted limitation,
in the set on purpose. Both fixes for it are fenced from this task (one is a new dependency,
one is a `@qcms/ui` change) and neither was taken.

## After sign-off

Nothing further is needed on the branch. Delete this file, open the PR with the exit-criteria
checklist and the gate images embedded by raw branch URL, and flip the ledger row in that PR.
