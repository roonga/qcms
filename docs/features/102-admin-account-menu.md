# 102 - Admin account menu

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 090, 097; design batch 5 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` sections 7 and 12 · `plan/work-order-sequence.md`

## Context

What every account sees about itself.

## Deliverables

- My account, with the link claim states (expired after 72 hours, used).
- My access, with the access explanation.
- "No access yet" home naming the administrator.

## Exit criteria

No spec criterion is owned here; the claim criteria are owned by 090.

- `forced-password-change.pw.ts` and the new claim path green.

## Negative tests

- My access reveals no other person's grants.

## Files and areas

`apps/admin/app/(shell)/{settings,me/access}/`, `apps/admin/components/membership/my-access-panel.tsx`, `apps/admin/components/account-menu.tsx`, `apps/admin/lib/i18n/en.ts`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: batch 5 (Account menu).

## Out of scope

Account administration (100).
