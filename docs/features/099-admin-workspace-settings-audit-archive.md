# 099 - Admin workspace Settings, Audit and Archive

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 084, 093, 097; design batch 3 seen by the Code Owner
**References:** `docs/WORKSPACE_ACCESS.md` sections 6, 9, 11, 12 and 13 · `plan/work-order-sequence.md`

## Context

The remaining Workspace area screens. `workspace-settings-panel.tsx` is shared with the builder's themes and lock (116), which depends on this task.

## Deliverables

- **Settings:** rename; second approval with pending and turn-on refusal states; the warning while the rule is on and nobody else could approve.
- **Audit:** the new kinds, mirrored site rows, a person filter, and the Requests row for workspace approval requests.
- **Archive:** refusal while forms remain, typed confirm, corrected wording; a rail row at two or more workspaces.

## Exit criteria

No spec criterion is owned here; the API criteria behind these screens are owned by 084 and 093, and criterion 45 by 101.

- `two-person-rule.pw.ts` updated and green.

## Negative tests

- The requester sees their own switch-off as pending and cannot approve it.
- The warning is shown once the only other approver is disabled.
- Archive with forms is refused inline.

## Files and areas

`apps/admin/components/membership/{workspace-settings-panel,audit-panel}.tsx`, `apps/admin/app/(shell)/workspaces/[workspaceId]/{settings,audit,archive}/`, `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/two-person-rule.pw.ts`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: batch 3 (Workspace area).

## Out of scope

Workspace themes and the appearance lock on Settings (116).
