# 055 - QCMS app theme application (Cobalt, Lexend, sharp)

**Stage:** 8a (admin train; ordering exception: runs after 031, before 032, so the question library and every later screen is built on themed components) · **Apps/packages:** `apps/admin` (plus consuming one existing `packages/ui` font asset) · **Depends on:** 031 (shell).
**References:** `plan/admin-theme/ADMIN_THEME.md` + `tokens.css` (the design, WCAG-verified at build time; revs 2-5 record the decision trail) · Claude Design cards `admin/theme.html` and `admin/design.html` in the QCMS Design System project · `plan/admin-theme/qcms-font-compare.html` (typeface decision record) · ADR-27 (i18n: control labels localized) · `docs/wireframes/admin-shell.md` (regions/states unchanged - this task changes appearance only, no wireframe re-sign).

## Context

Task 031 shipped the shell and auth flows with near-default styling. The visual design is now settled and Code-Owner-approved (2026-07-30): slate neutrals shared with the portal registry, brand cobalt accent (#2456C6 light / #7AA2FF dark), translucent mode-following topbar, **sharp industrial corners** (control 4px / card 8px / small 2px) as the app's Corners brand character, **Lexend** as the app typeface, dense 40px controls. The app is never respondent-themed; mode (light/dark/HC) is a per-operator control. No user-facing string says "admin" - the product is QCMS and the respondent app is the Portal (Code Owner naming call, 2026-07-30); code identifiers (`apps/admin`, package names, paths) are unchanged.

## Deliverables

- **Token sheet landed as the app's stylesheet:** `plan/admin-theme/tokens.css` copied into `apps/admin` (placement per the app's existing global-CSS structure), byte-identical values. It is the only source of colour in the app: components consume `--color-*` / `--admin-*` / `--radius-*` custom properties, never literal colours.
- **Shell restyled:** topbar (translucent mode-following chrome, accent active-underline), nav, sign-out, content area, auth cards (sign-in, 2FA enroll/challenge/recovery, recovery codes), placeholder area screens, banners - all via tokens. The wordmark is **QCMS** with no "admin" sub-label; sweep any other user-facing "admin" strings the shell carries.
- **Typeface:** the app face is **Lexend**, consumed from the registry's existing `packages/ui/src/fonts/lexend-variable.woff2` (OFL-1.1, already in `packages/ui/src/fonts/NOTICE.md`; no new dependency, no second copy of the file - reference or re-export the existing asset). System stack remains the `@font-face` fallback only; operators get no font switcher. Table numeric cells use `font-variant-numeric: tabular-nums`.
- **Mode control (light / dark / high-contrast):** a labeled control in the topbar (matching the portal's runtime-control pattern). Default follows `prefers-color-scheme`; an explicit choice persists per operator (client-side persistence is fine at this tier); HC is only ever explicit, never inferred. Labels localized per ADR-27. Applied as the root class convention from the sheet (bare = light, `.dark`, `.hc`).
- **Gate evidence:** fresh screenshot set under `docs/gates/055/` - sign-in, 2FA challenge, shell (Questions), Settings - each at 390px and 1280px in all three modes, with a README in the 031 style.

## Exit criteria

1. No literal colour values in `apps/admin` component styles: an enforceable check (lint rule or grep gate) proves every colour outside the token sheet is a `var(--...)` reference.
2. The landed token sheet is value-identical to `plan/admin-theme/tokens.css` (drift check in the PR diff; if design iterates, the plan copy updates in the same PR).
3. Lexend renders as the app face (asserted, e.g. computed font-family in an e2e check) with no new font file added to the repo; no user-facing "admin" string remains in the shell (grep gate over rendered strings or i18n catalog).
4. Mode control cycles light/dark/HC, persists across reload, defaults to `prefers-color-scheme`, and never auto-enters HC; labels come through the i18n layer (ADR-27).
5. The 031 axe gate stays green in all three modes (run per mode, not just default).
6. `pnpm verify` and `pnpm verify:browser` green; no new dependencies.
7. Screenshot set delivered for the Code Owner's sign-off (human gate; the task is not done until signed).

## Out of scope

Respondent theming of the QCMS app (never happens); the managed theme editor (049); any `apps/portal` change and any `packages/ui` change beyond consuming the existing Lexend asset; font or density controls for operators (one face, dense by default - revisit only on operator feedback); corners variants (the app ships its sharp 4/8/2 set as brand character; the portal keeps Subtle).
