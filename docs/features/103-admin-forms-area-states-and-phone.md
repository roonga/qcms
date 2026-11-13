# 103 - Admin forms-area states and phone widths

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 093, 094, 097 to 102; design batches 6 and 7 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` sections 12 and 13 · `docs/COMPONENT_GUIDELINES.md` · `plan/work-order-sequence.md`

## Context

The UI tail: role-aware states on the forms area, the held publish on the form, and a phone-width and accessibility pass over every access screen.

## Deliverables

- Disabled-with-reason states on Forms, Operations, Responses and Erase per role and environment.
- On the Publish tab, the pending state of a held draft publish to `prod` on a prod-only site, with Approve for another Publish forms holder for `prod` (API from 093).
- A phone-width pass over every access screen.
- An accessibility pass over every new access screen per `docs/COMPONENT_GUIDELINES.md`.

## Exit criteria

Spec criteria owned: **115**. This task owns that and no other.

- Every batch 6 and 7 artboard matched.

## Negative tests

- The route still answers denied when a control is hidden.
- The requester of a held prod-only draft publish sees it pending with no Approve.

## Files and areas

`apps/admin/app/(shell)/forms/`, `apps/admin/app/(shell)/operations/forms/[formId]/`, `apps/admin/components/`, `apps/admin/lib/i18n/en.ts`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: batches 6 and 7.

## Out of scope

New API acts. The builder screens (113 to 117).
