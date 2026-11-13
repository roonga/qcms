# 098 - Admin Members and Access groups

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 089, 091, 097; design batch 3 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` sections 3, 4, 12 and 13 · `plan/work-order-sequence.md`

## Context

The Workspace area screens for people and groups, on the API of 085, 089 and 091.

## Deliverables

- **Members:** list with filters; a person page with the access explanation; add by exact address; remove; appoint and remove Workspace administrator; re-confirm suspended memberships (hidden for the membership's own subject).
- **Access groups:** several roles plus one environment set (picker hidden for View forms and Edit forms only); rename; delete, starter groups included; the uncovered notice.
- The missing PUT client in `lib/server/membership.ts`.

## Exit criteria

Spec criteria owned: **15, 96**. This task owns those and no others.

- Flows match the batch 3 artboards; `membership.pw.ts` green.

## Negative tests

- A non-administrator gets `DeniedRecovery`.
- With second approval on, a self-grant into a response group, or a response role or environment added to a group the actor is in, shows pending, not success.
- Re-confirm is hidden for the membership's own subject, and the route still refuses it.

## Files and areas

`apps/admin/app/(shell)/workspaces/[workspaceId]/{members,access-groups}/`, `apps/admin/components/membership/`, `apps/admin/lib/server/membership.ts`, `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/membership.pw.ts`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: batch 3 (Workspace area).

## Out of scope

Settings, Audit, Archive (099).
