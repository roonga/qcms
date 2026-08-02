HANDOFF: AWAITING-HUMAN screenshot gate, evidence at docs/gates/035/

# 035 - Admin responses, erasure, and webhook operations

Every deliverable and every exit criterion is implemented and green. The only thing
left is the human screenshot gate, which only the Code Owner can sign.

## State

- Branch `feat/035-admin-responses-webhooks-ops`, pushed, four commits on top of
  `4e22b3d`.
- `pnpm verify` green at the repo root (exit 0), with `pnpm exec turbo run test --force`
  reporting `0 cached, 14/14` so the test leg is proven to have executed.
- `QCMS_PORT_SEAT=0 pnpm verify:browser` green: 168 passed, 26 skipped (the four gate
  capture specs, which are flag-gated).
- The tree is clean. Nothing is red.

## What the human has to do

Review the 78 PNGs under `docs/gates/035/` (13 states x 2 viewports x 1280/390 x 3
modes) against `docs/gates/035/README.md`, which names every frame and is explicit about
the two wireframe states this build could not reach. Approving the gate is the last step
before this can merge.

Regenerating the set, if a frame needs re-shooting:

```
QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
  --project=admin-chromium gate-screenshots-035
```

## Next step after sign-off

Nothing in the code. Open the PR with the exit-criteria checklist, embed the gate frames
by raw branch URL, and let the reviewing seat post its sentinel.
