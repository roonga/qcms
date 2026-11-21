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
  - Workspace themes on workspace settings: list, rename, delete, logo upload (raster only), for Edit forms holders. A theme is created from the drawer's "Save as workspace theme", which is 117's (Code Owner, 2026-11-22).
  - The appearance lock switch for a Workspace administrator or Site administrator, with its explanation.
- Strings in `apps/admin/lib/i18n/en.ts`.

## Exit criteria

Spec criteria owned: none. 109 owns criteria 118 and 120 to 122 at the API.

- The UI never offers an act the API would refuse.

## Required tests

- X1 (Vitest): the text-size rule module (bounds, Custom state, the 32 px cap note per Q9).
- Playwright (X3): open the drawer, change theme and text size, see the preview update, save; locked workspace shows the locked state and the PUT is not attempted; themes CRUD and logo upload on settings; the lock switch disabled with "Needs Workspace administrator." named through `aria-describedby` (Code Owner, 2026-11-22, replacing "hidden"); axe clean.
  - That disabled state is covered in `apps/admin/components/membership/workspace-appearance-panel.test.tsx` rather than in the browser, because no caller reaches the screen in it: the Workspaces area needs `workspace: read`, which only a Workspace administrator holds, so an Edit forms holder who is no administrator is refused workspace Settings before the panel renders. The browser test covers the reachable split instead, a Workspace administrator holding no Edit forms grant.
  - Open question for the Code Owner: U6 puts the themes list on workspace Settings "for Edit forms holders", and `docs/WORKSPACE_ACCESS.md` section 12 records that row the same way, but that screen is an administrator's. Either the Workspaces area admits an Edit forms holder, or the themes half of Settings is an administrator's and the Edit forms holder reaches themes only through the builder drawer (117).

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

Cleared by ruling (Code Owner, 2026-11-22). The drawer is drawn on the Agent Builder canvas (Appearance, Appearance-Panel, TextSize-Card) and the lock switch on the Workspaces Area canvas (Settings-States, Screens-C, design batch 3). The ruling settles the rest without new boards:

- A theme is created only from the drawer's "Save as workspace theme" (117). Settings lists, renames, deletes and takes a logo.
- The logo upload sits on the theme row in Settings; the drawer shows the logo read-only.
- The drawer's locked state applies the text-size card's locked language to every control, with one reason line, "Locked by your workspace. A Workspace administrator can unlock it in Settings.", wired with `aria-describedby`.
- The contrast correction report is worded from 107's `APPEARANCE_CONTRAST` failures in the drawer's own style; it is not drawn.
- The shipped themes are exported as data from `@roonga/qcms-ui`, for the admin now and the portal and 117's derive later; there is no generated admin copy.
- The theme list read carries the appearance lock, so an Edit forms holder who cannot read workspace settings still sees it.
- `themes.create.note` ships now and becomes true when 117 lands.

## Out of scope

Derive and theme action kinds (117). Portal rendering (118).
