HANDOFF: AWAITING-HUMAN screenshot gate, evidence at docs/gates/034/

# 034 - admin publish, preview, version history, secure links

## State

**Code complete and green.** Every deliverable and every exit criterion is implemented and
passing. The only thing outstanding is the human screenshot gate, which is not mine to sign.

- `pnpm verify` green at root, and `pnpm exec turbo run test --force` re-ran the whole test
  leg with `0 cached, 14 total` so the pass is not a turbo cache replay.
- `QCMS_PORT_SEAT=0 pnpm verify:browser` green: 160 passed.
- Working tree clean; nothing is parked half-done.

## What is wired

**API (`apps/api/src/features/forms/`)** - `POST /admin/forms/{id}/draft/preview`: a dry run
that compiles the submitted draft with the same `compileForm` publish uses and returns 011's
documents plus the forward pass's visible set for the answers sent with the request. It
writes nothing. A draft that would not publish comes back 422 `PREVIEW_REJECTED` carrying the
kernel's `PublishError[]` verbatim. Registered, OpenAPI document regenerated, integration
tests added.

**`@qcms/ui`** - `documentForVisible` moved out of `apps/portal/lib/visible.ts` and is now a
package export, so the portal and the admin preview share one projection as well as one
renderer. Changeset added (`minor`).

**`apps/admin`** - four sections under `/forms/[formId]`: builder (publish + close/reopen),
`/preview`, `/versions` (+ `/versions/[version]`), `/links`. Proxies, server actions, view
types, message catalog, CSS. The preview renders inside a single `qcms-preview-surface`
container that owns its styling boundary (Code Owner ruling 2026-08-02); 034 builds only that
boundary, with no theme selection, no mode switching and no portal-theme defaulting.

## What the human gate needs

`docs/gates/034/` holds **66 PNGs**: eleven states x 390px and 1280px x light, dark and high
contrast, plus a `README.md` naming each state. Timestamps in the operator tables render
locale-aware in UTC with the zone named (ADR-27); the CSV export keeps ISO. The Consumed and
Expired link chips are absent by decision: reaching them needs a respondent session and a
clock this suite does not have, and faking them would be evidence of nothing. Capture them again with:

```
QCMS_ADMIN_CAPTURE_GATE=1 QCMS_PORT_SEAT=0 pnpm exec playwright test --project=admin-chromium gate-screenshots-034
```

## Next step

The Code Owner reviews the PNGs from GitHub and signs off (or does not). Nothing in the
branch changes in the meantime. After sign-off this is ready to land: the ledger row for 034
flips in the completing PR, which is the conductor's edit, not this branch's.

## Nothing is red

There is no failing gate, no skipped suite and no known defect on this branch. `AWAITING-HUMAN`
here means a person has to look at pictures, not that anything is broken.
