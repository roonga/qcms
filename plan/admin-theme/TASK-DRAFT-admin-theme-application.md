# DRAFT - Admin theme application (Cobalt)

**Proposed number:** next free (056 if 055 stays reserved for the OpenAPI/Scalar proposal). Lands in `docs/features/` with a ledger row on the Code Owner's go-ahead; this draft rides PR #199 beside the design it applies.
**Stage:** 8a (admin train) · **Apps/packages:** `apps/admin` only · **Depends on:** 031 (admin shell). **Slot: immediately after 031 merges, before 032** - so the question library and every later admin screen is built on themed components rather than restyled afterwards.
**References:** `plan/admin-theme/ADMIN_THEME.md` + `tokens.css` (the design, PR #199; WCAG-verified at build time) · Claude Design card `admin/theme.html` · ADR-27 (i18n: control labels localized) · `docs/wireframes/admin-shell.md` (regions/states unchanged - this task changes appearance only, no wireframe re-sign).

## Context

Task 031 shipped the admin shell and auth flows with near-default styling. The admin's visual theme (QCMS Cobalt) is now designed and verified: slate neutrals shared with the portal registry (051), a cobalt accent, a fixed cobalt-navy topbar chrome group, and light/dark/high-contrast modes via the universal HC layer. The admin is never respondent-themed - portal themes are the adopter's choice for respondents; the admin always wears Cobalt. Mode is a per-operator control.

## Deliverables

- **Token sheet landed as the admin's stylesheet:** `plan/admin-theme/tokens.css` copied into `apps/admin` (placement per the app's existing global-CSS structure), byte-identical values. It is the only source of colour in the admin: components consume `--color-*` / `--admin-topbar-*` / `--radius-*` / `--admin-*` custom properties, never literal colours.
- **Shell restyled:** topbar (translucent mode-following chrome, accent active-underline), nav, sign-out, content area, auth cards (sign-in, 2FA enroll/challenge/recovery, recovery codes), placeholder area screens, banners - all via tokens. The wordmark is **QCMS** with no "admin" sub-label (no user-facing string says "admin"; Code Owner naming call, 2026-07-30).
- **Typeface:** the app face is **Lexend**, consumed from the registry's existing `packages/ui/src/fonts/lexend-variable.woff2` (OFL-1.1, already in `NOTICE.md`; no new dependency, no second copy of the file). System stack remains the `@font-face` fallback only; operators get no font switcher.
- **Mode control (light / dark / high-contrast):** a labeled control in the topbar (matching the portal's runtime-control pattern). Default follows `prefers-color-scheme`; an explicit choice persists per operator (client-side persistence is fine at this tier); HC is only ever explicit, never inferred. Labels localized per ADR-27. Applied as the root class convention from the sheet (bare = light, `.dark`, `.hc`).
- **Gate evidence:** fresh screenshot set under `docs/gates/<NNN>/` - sign-in, 2FA challenge, shell (Questions), Settings - each at 390px and 1280px in all three modes, with a README in the 031 style.

## Exit criteria

1. No literal colour values in admin component styles: an enforceable check (lint rule or grep gate) proves every colour in `apps/admin` styles outside the token sheet is a `var(--...)` reference.
2. The landed token sheet is value-identical to `plan/admin-theme/tokens.css` (drift check in the PR diff; if design iterates, the plan copy updates in the same PR).
3. Mode control cycles light/dark/HC, persists across reload, defaults to `prefers-color-scheme`, and never auto-enters HC; labels come through the i18n layer (ADR-27).
4. The 031 axe gate stays green in all three modes (run per mode, not just default).
5. `pnpm verify` and `pnpm verify:browser` green; no new dependencies expected (tokens are plain CSS).
6. Screenshot set delivered for the Code Owner's sign-off (human gate; the task is not done until signed).

## Out of scope

Respondent theming of the QCMS app (never happens); the managed theme editor (049); any `apps/portal` change and any `packages/ui` change beyond consuming the existing Lexend asset; font or density controls for operators (one face, dense by default - revisit only on operator feedback); corners variants (the app ships its sharp 4/8/2 set as brand character; the portal keeps Subtle).
