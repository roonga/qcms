HANDOFF: AWAITING-HUMAN screenshot gate, evidence at docs/gates/035/

# 035 - Admin responses, erasure, and webhook operations

Every deliverable and every exit criterion is implemented and green, and the PO review of
PR #284 has been answered in full. The only thing left is the human screenshot gate,
which only the Code Owner can sign.

## State

- Branch `feat/035-admin-responses-webhooks-ops`, rebased onto `812ff63`. (No commit
  count here on purpose: it goes stale on every review round, and a park record that
  carries a wrong number is the same defect this task was rejected for twice.)
- The five blockers from `PO-REVIEW: CHANGES-REQUESTED @7ebace2` are addressed, each with
  an assertion rather than a claim: the erase dialog and `docs/erasure.md` now say an
  undelivered event for the session is not withdrawn, and `POST
  /admin/outbox/:id/redeliver` answers `409 DELIVERY_SESSION_ERASED` (B1); the four
  `void call().then(...)` sites render a sentence on rejection (B2); the tombstone card
  and the erasure log render the catalog form of the reason (B3); the export dialog's
  empty-result sentence is format-aware (B4); pagination links come from the applied
  filter set and the controls re-seed when it changes (B5).
- The three gate follow-ups are done: frames are `<state>-<mode>-<viewport>` as in 033
  and 034, the delivery-detail frames are re-shot with horizontal scroll reset, and the
  capture masks the revealed secret before the shutter so no committed frame carries a
  minted value.
- Whether erasure should purge or redact the session's `outbox` rows is an ADR-17
  amendment, decided by the Code Owner and drafted as task 059. 035 ships the stopgap
  only: truthful copy, the redeliver refusal, and the payload assertion. `eraseSession`'s
  deletion scope is untouched here.
- `pnpm verify` green at the repo root (exit 0), with `pnpm exec turbo run test --force`
  reporting `0 cached` so the test leg is proven to have executed.
- `QCMS_PORT_SEAT=0 pnpm verify:browser` green.
- The tree is clean. Nothing is red.

## What the human has to do

Review the 78 PNGs under `docs/gates/035/` (13 states x 3 modes x two viewports, 390px
and 1280px) against `docs/gates/035/README.md`, which names every frame and is explicit
about the two wireframe states this build could not reach. Approving the gate is the last
step before this can merge.

Regenerating the set, if a frame needs re-shooting:

```
QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
  --project=admin-chromium gate-screenshots-035
```

## Next step after sign-off

Nothing in the code. The frame-renaming commit moved all 78 filenames, so the PR body's
raw-branch-URL embeds need regenerating from the current names before the Code Owner
reviews from GitHub. Then delete this file as the last commit before merge, as 033 and
034 both did.
