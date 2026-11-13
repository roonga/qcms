# 116 - Appearance drawer, workspace themes and lock settings

**Stage:** 9 (Phase 4) · **Apps/packages:** `apps/admin` · **Depends on:** 109, 099, 113, 114; the Appearance drawer and the workspace settings additions on the Agent Builder design canvas seen by the Code Owner
**References:** `plan/agent-builder-decisions.md` (U4, U6, Q9, Q10, Q18) · `docs/WORKSPACE_ACCESS.md` sections 3, 9 and 12 · `plan/work-order-sequence.md`

## Context

The human editing surface for appearance. The drawer opens from the builder and edits the draft's appearance through the draft PUT (109); workspace themes and the lock live on workspace settings, after 099 reshapes that panel.

## Deliverables

- U4:
  - Appearance drawer: theme, face, corners, density, admin text-size base, progress mode, page tint; live in the preview (114); saved through the draft PUT.
  - `apps/admin/lib/forms/text-size.ts`: a pure rule module for the text-size base, where "Custom" is a state, not a stored value.
  - Locked state: every control disabled with the reason and who can clear the lock.
  - 107's correction report worded when a choice fails contrast.
- U6:
  - Workspace themes on workspace settings: list, create, rename, change, delete, logo upload (raster only), for Edit forms holders.
  - The appearance lock switch for a Workspace administrator or Site administrator, with its explanation.
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none. 109 owns criteria 118 and 120 to 122 at the API.

- The UI never offers an act the API would refuse.

## Required tests

- X1 (Vitest): the text-size rule module (bounds, Custom state, the 32 px cap note per Q9).
- Playwright (X3): open the drawer, change theme and text size, see the preview update, save; locked workspace shows the locked state and the PUT is not attempted; themes CRUD and logo upload on settings; the lock switch hidden for an Edit forms holder; axe clean.

## Files and areas

`apps/admin/components/forms/` (drawer, new), `apps/admin/lib/forms/text-size.ts` (new), `apps/admin/lib/appearance.ts`, `apps/admin/components/membership/workspace-settings-panel.tsx`, `apps/admin/app/(shell)/workspaces/[workspaceId]/settings/`, `apps/admin/lib/server/` (theme and lock calls), `apps/admin/lib/i18n/en.ts`, `apps/admin/e2e/`.

## Migration

None.

## Gates

V, B (`plan/work-order-sequence.md`, Gates).

## Review

Opus first round; Sonnet delta.

## Design gate

Yes: the Appearance drawer (with its locked state) and the settings additions on the Agent Builder canvas, seen by the Code Owner before dispatch.

## Out of scope

Derive and theme action kinds (117). Portal rendering (118).
