HANDOFF: AWAITING-HUMAN screenshot gate, evidence at docs/gates/048/

# 048 - Author-supplied validation messages and boolean label overrides

Every deliverable and every exit criterion is implemented, reviewed APPROVE, and
green on a tree rebased onto current main. The only thing left is the human
screenshot gate, which only the Code Owner can sign.

## State

- Branch `feat/048-author-validation-messages`, pushed, rebased onto `dc40a83`
  (which carries task 035). No commit count recorded here on purpose: it goes
  stale on every round.
- `pnpm verify` exit 0. `pnpm exec turbo run test --force` reported
  `Cached: 0 cached, 14 total` with 1854 tests across 129 files, so the test leg
  is proven to have executed rather than replayed cache.
- `QCMS_PORT_SEAT=2 pnpm verify:browser`: 175 passed, 30 skipped (all
  flag-gated `gate-screenshots*` specs). One red in
  `apps/portal/e2e/anonymous-flow.pw.ts:36`, a load flake in a file this diff
  does not contain: the journey completed, the spec passes in isolation on the
  same seat, the box was under two foreign container stacks, and the diff has no
  JSON-parsing site that could throw it. Filed as its own issue.
- The ledger row is deliberately still `todo`. It flips inside the completing PR
  as a final commit before merge, per the session protocol.

## What the human has to do

Sign off (or reject) the 18 frames under `docs/gates/048/`, embedded in the PR
body by raw branch URL. `docs/gates/048/README.md` names what to look at.

**The judgement being asked for is the 390px one.** A default validation message
is a full sentence inside a narrow input, so it visibly clips in the
`messages-placeholders-*-390` frames. This was deliberately not pre-empted:
whether that is acceptable, or wants truncation, wrapping, or a different
affordance, is the Code Owner's call and not the executor's.

## What happens on approval

1. Delete this file as the last commit, after the signature (the convention 033,
   034 and 035 all followed).
2. Flip the ledger row to `done (PR #<n>; ...)`.
3. Rebase onto whatever main has become, re-run the gates, merge via
   `gh pr merge --squash` once a `PO-REVIEW: APPROVE` sentinel is bound to the
   head being merged.
