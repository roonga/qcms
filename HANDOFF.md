HANDOFF: AWAITING-HUMAN Code Owner sign-off on the task 059 erase-dialog copy frames in `docs/gates/059/`

## State

Task 059 is implemented and every automated gate is green. Exit criteria 1-7 are
done and evidenced; **exit criterion 8 is the human screenshot gate** and is the
only thing outstanding. Nothing here is red and nothing is half-finished.

## What the human must do

Review the six `erase-confirm` frames in `docs/gates/059/` (390px and 1280px, in
light, dark and high contrast) and approve the erase dialog's rewritten third
ADR-17 paragraph. `docs/gates/059/README.md` names exactly what changed: 035's
"an event still waiting to be delivered is not withdrawn by this action: it may
still be sent" is replaced by the three post-059 facts (delivered events stay
delivered and are the consumer's to erase as an independent controller;
undelivered events for this session are cancelled and never sent; QCMS's own
stored copy of the answers is redacted).

Only the erase dialog moved, so the rest of `docs/gates/035/` still stands and is
not re-shot. The delivery dashboard's new `cancelled` badge is asserted rather
than photographed (`apps/admin/e2e/responses-ops.pw.ts` step 8) - reaching that
state in a capture needs the whole 035 delivery arc per mode to show one tag.

## Next step after sign-off

Open the PR (exit-criteria checklist as the body, each gate image embedded by raw
branch URL) and flip the ledger row. Neither was done here by instruction.

## Gates as of this commit

- `pnpm verify` - green at root.
- `pnpm exec turbo run test --force` - `0 cached`, 14/14 tasks pass (so the test
  leg genuinely executed rather than replaying the main checkout's turbo cache).
- `QCMS_PORT_SEAT=2 pnpm verify:browser` - 176 passed, 0 failed, 34 skipped
  (10.2m).
- `QCMS_ADMIN_CAPTURE_GATE=1 ... gate-screenshots-059` - 4 passed, six PNGs
  written and committed.
