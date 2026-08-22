# Wireframe - Admin shell, sign-in, 2FA

**Status:** Signed off: Code Owner, 2026-07-21 · **Consumed by:** 031 · **Renders:** better-auth flows (031), `/admin` group auth

## ASCII sketch - authenticated shell

```
┌─ shell ─────────────────────────────────────────────┐
│ [logo] Questions Forms Responses Webhooks Settings ☾◍│
│ ┌─ content ──────────────────────────────────────┐  │
│ │ (per-area screens - see sibling wireframes)    │  │
│ └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **shell top bar**: logo slot · primary nav - Questions / Forms / Responses / Webhooks / Settings (links; active state visible) · trailing group. **Revised by 032 (screenshot gate `docs/gates/032/`), superseding 055's three-chip mode control and this bar's standalone sign-out `button`:** the trailing group is exactly two 32px controls, each a popup `menu` (Code Owner call, 2026-07-31; the frozen design card `plan/admin-theme/ds-navbar.html`, sections "Appearance mode control" and "Account menu", is normative for their shapes).
  - **appearance trigger**: square, icon-only, no caret, borderless at rest; a sun / crescent moon / half-filled circle glyph shows the current mode and the accessible name says it in words. High contrast keeps a permanent border by design. Its menu is three `menuitemradio` rows (Light / Dark / High contrast). Default follows `prefers-color-scheme`; an explicit choice persists per operator; high-contrast is only ever explicit.
  - **account trigger**: circular initials monogram, no image and no external avatar service. Its menu carries a non-interactive "Signed in as {email}" header, a separator, **Change password** (routes to the settings password screen) and **Sign out** (immediate, no confirmation).
  - Still chrome, not a screen: no state, no route, nothing else in this wireframe changes. **Sign-out remains possible without JavaScript** (Code Owner decision, 2026-07-31): a `<noscript>` block hides both triggers and reveals the plain POST sign-out form, which is the same form the scripted menu item submits. The appearance control is JavaScript-only, which is accepted - a preference is not a session.
- **rail** (form-scoped screens only, added by issue 559): a `navigation` landmark occupying a 240px grid column beside the content column at and above `--bp-sidebar`, and a `disclosure` stacked above it below that boundary. It carries two groups separated by one divider - the form's steps (each with its issue count where it has one) and the form's six sibling routes - and it carries no actions and no same-page section switches. Every row is a link with `aria-current="page"` on the active one, never a `button`: the rail works with JavaScript disabled and every row can be opened in a new tab. `plan/admin-design-contracts.md` §7 is normative for its contents and §7a for the separately-named Settings rail that shares only its column, width, collapse behaviour and anchors-not-buttons rule. Issue 559 wires it on the secure-links screen; the remaining seven form-scoped screens are issue 561.
- **content**: the routed area screen. Breadcrumb (`breadcrumb`) at content top on nested routes (e.g. Forms / {form} / Builder). On a screen carrying the rail, the six section links are the rail's and the content's own section strip is not rendered - one screen never offers the same six routes twice.
- **Settings** area at launch: account (change password → sessions invalidated), 2FA re-enrollment, nothing else (RBAC etc. is Phase 4). **Extended by issue #319:** the 2FA card carries a **regenerate recovery codes** form for an enrolled account - a password `text-field` and a secondary `button`, landing on the same one-time display the enrollment flow uses. It is not a widening of the area: it is the only remedy for lost codes, since nothing reads the stored set back, and it sits under the same "2FA re-enrollment" line. Password-gated because better-auth requires the password, which is the re-authentication the operation wants.

### Auth screens (inventory-only)

- **Sign-in**: `card` - email `text-field`, password `text-field` (masked), submit `button`. Generic failure message (no user enumeration - SEC-1). Throttled state shows generic "try again later" `alert`.
- **2FA enrollment** (first sign-in, enforced by default): `card` - QR code image + manual secret (`text`, copyable), TOTP code `text-field`, verify `button`; then **recovery codes screen**: one-time display (`card`, copy-all `button`, "I have saved these" confirm `button` gates continue - codes never shown again). **"Never shown again" is literal since issue #319:** the QCMS route that read the stored codes back is removed, the display is fed by the step that issued them, and an admin who has lost them regenerates from Settings rather than re-reading. **Accepted deviation (031, screenshot gate signed 2026-07-31):** the copy-all `button` is not built. It needs client-side clipboard access plus a status region, a client interaction pattern the admin has no other use for yet; the codes render as a selectable list that works with keyboard and mouse. Revisit if a second screen needs the same pattern.
- **2FA challenge** (each sign-in): TOTP code `text-field`, verify `button`, "use a recovery code" link → recovery-code `text-field` variant.
- **First-run note**: no self-registration UI exists anywhere (SEC-1); first admin via `pnpm qcms:create-admin` - sign-in screen shows nothing about registration.

## States (normative)

signed-out · sign-in error (generic) · sign-in throttled · 2FA-enroll · recovery-codes-display (one-time, reached from enrollment **or** from a Settings regeneration) · recovery-codes-regenerate-error (generic, beside the Settings form) · 2FA-challenge · 2FA-recovery-entry · authenticated · session-expired (redirect to sign-in with "session expired" `alert`).

## Interactions

- All auth flows through better-auth in the admin BFF (031); admin API calls carry the session (R2).
- Unauthenticated access to any admin route → redirect to sign-in. Unauthenticated `/admin` API call → 401 (middleware, 031).

## A11y notes

- Sign-in error `alert` receives focus. QR screen: manual secret is the accessible alternative to the QR image (labeled, copyable). Recovery codes announced as a list (the copy-all status text goes with the deferred copy-all button above). Nav is a labeled landmark; active page `aria-current`. axe gate active from 031, and from 055 it runs in all three modes rather than only the one the machine prefers. Active nav is never colour-only (weight plus an accent underline); nor is the appearance menu's checked row (a leading check glyph, a bolder label, an inset accent edge), which is the one state an operator in high-contrast has to be able to read. **Revised by 032:** both trailing-group triggers are wordless, so `aria-label` is the whole control to a screen reader - "Appearance: {mode}" (it names the control AND its current value, which is what the old visible chip did between its border and its check mark) and "Account menu for {email}". Both menus keep react-aria's keyboard contract: Enter, Space or Arrow Down opens, arrows navigate, Escape closes and returns focus to the trigger. The axe gate runs with each menu OPEN as well as closed, in all three modes and with the checked row moved between passes.

Signed off: Code Owner, 2026-07-21
