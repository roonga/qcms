# Wireframe - Admin shell, sign-in, 2FA

**Status:** Signed off: Code Owner, 2026-07-21 · **Consumed by:** 031 · **Renders:** better-auth flows (031), `/admin` group auth

> **Amendment, issue #612 (Settings is a screen, not a bullet).** This file described
> `/settings` only as the `Settings area at launch` bullet inside the shell's Regions, so
> the one screen in the app that is neither chrome nor an auth screen had nothing saying
> what it is headed by or what it is made of. That is the D1 shape #574 named on version
> detail and response detail: a route of its own appearing as a bullet inside another
> screen's inventory. It has an inventory of its own below, and the bullet points at it
> rather than absorbing it. It stays in this file rather than becoming a file of its own
> because it renders the same better-auth flows the auth screens above do, and because the
> account menu in the shell chrome links directly into one of its sections. Everything down
> to the first A11y notes describes the **shell** and the auth screens; the new section
> describes the Settings screen.

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
- **rail** (§7's rail: form-scoped screens only, added by issue 559; the Settings screen's §7a rail is a different component sharing the same column, and is inventoried with that screen below): a `navigation` landmark occupying a 240px grid column beside the content column at and above `--bp-sidebar`, and a `disclosure` stacked above it below that boundary. It carries two groups separated by one divider - the form's steps (each with its issue count where it has one) and the form's six sibling routes - and it carries no actions and no same-page section switches. Every row is a link with `aria-current="page"` on the active one, never a `button`: the rail works with JavaScript disabled and every row can be opened in a new tab. `plan/admin-design-contracts.md` §7 is normative for its contents and §7a for the separately-named Settings rail that shares only its column, width, collapse behaviour and anchors-not-buttons rule. Issue 559 wired it on the secure-links screen, issue 561 across the remaining seven form-scoped screens, and issue 562 added the §7a Settings rail: **all eight form-scoped screens carry the §7 rail today, and `/settings` carries the §7a one**, which is the whole of the slot's occupancy. It is filled by the `@rail` parallel-route tree (`apps/admin/app/(shell)/@rail/`) and renders as a **sibling of the capped content column, never a child of it** - a rail nested inside `<main>` would make the per-route width cap govern rail-plus-content and quietly take 240px off the measure the route was assigned (`app/(shell)/layout.tsx:46-65`). The contract does not yet say which of the two the cap governs; **#623** is open on that silence, and the composition above is what ships.
- **content**: the routed area screen. Breadcrumb (`breadcrumb`) at content top on nested routes (e.g. Forms / {form} / Builder). On a screen carrying the rail, the six section links are the rail's and the content's own section strip is not rendered - one screen never offers the same six routes twice.
- **Settings**: **a route of its own** (`/settings`) with its own inventory below, reached from the shell nav and from the account menu's Change password item. The area at launch is account (change password → sessions invalidated) and 2FA re-enrollment, **nothing else** (RBAC etc. is Phase 4), and that "nothing else" is the binding half; what the screen is made of, and the §7a rail beside it, are inventoried there rather than here. **Extended by issue #319:** the 2FA section carries a **regenerate recovery codes** form for an enrolled account - a password `text-field` and a secondary `button`, landing on the same one-time display the enrollment flow uses. It is not a widening of the area: it is the only remedy for lost codes, since nothing reads the stored set back, and it sits under the same "2FA re-enrollment" line. Password-gated because better-auth requires the password, which is the re-authentication the operation wants.

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

---

# Screen - Settings (`/settings`)

**Consumed by:** 031 (the screen), 032 (the account menu's link into it), issue 562 (the §7a rail) · **Renders:** better-auth flows (031), `POST /settings/password`, `POST /settings/recovery-codes` · **Implemented by:** `apps/admin/app/(shell)/settings/page.tsx`, with its rail at `apps/admin/app/(shell)/@rail/settings/page.tsx`

A route of its own, and the only screen in this file that is not an auth screen: the
sections above describe the shell chrome that wraps every screen and the screens that sit
outside it. This one is scoped to **the signed-in account**, and its content is that
account's two credentials.

Inventory-only, per the format spec's allowance for simple screens: three cards, two forms
and a rail.

## Regions (normative) - Settings

- **§7a section rail** (`SettingsSectionRail`, `apps/admin/components/settings-section-rail.tsx`), filled by the `@rail/settings` parallel-route slot. It is a **sibling of the capped content column, not a child of it**, for the reason the rail bullet above gives (`@rail/settings/page.tsx:7-17`).
  - **It is a distinct component from the §7 form-subtree rail, and the two must not be described as one thing.** §7's rail carries navigation between **routes** and explicitly never carries a same-page section switch; Settings is one route, so a rail here can only carry same-page section switches, which is precisely what §7 forbids. They share the grid column, the 240px width, the `--bp-sidebar` collapse behaviour and the anchors-not-buttons rule, **and nothing else** (§7a). There is no base component, no shared props type and no variant flag between them, deliberately.
  - **What it carries: three fragment anchors and nothing else.** No routes, no actions, no counts. Each row is a bare `<a href="#section">` rather than a `next/link`, because routing an in-page jump through the App Router would re-render the screen the reader is standing on and empty a half-typed password field (`:29-37`).
  - **The active section is the fragment in the URL**, marked in the stylesheet with `:target` rather than by a script, because §7a binds this rail to the anchors-not-buttons rule and a mark only a script could produce would make the rail's contract conditional on JavaScript (`:39-60`). The mark is not colour alone: an accent edge and heavier weight, plus a visually-hidden `Current section` phrase inside the active row, which is what replaces the `aria-current` a stylesheet cannot set. It deliberately does **not** follow the scroll: before any choice is made there is no active section, and the rail says so with its own fallback name rather than guessing at the topmost one.
  - **Collapsed below `--bp-sidebar`** it is a native `<details>` whose summary names the active section, or `Sections` when the URL names none. All four names are in the DOM and CSS reveals one, `display: none` taking the other three out of the accessibility tree rather than merely hiding them.
- **page heading**: one `h1`, `Settings` (`settings.title`) (`:59`).
- **Account `section`** (`id="account"`): an `h2` `Account`, and the signed-in email as `text` (`:61-80`).
- **Change password `section`** (`id="change-password"`): an `h2`, the sentence stating that changing the password signs out every other session on every device, a success `alert` when the address carries `?changed`, a **generic** error `alert` when it carries `?error`, then a plain `method="post"` `form` to `/settings/password` with current-password and new-password `text-field`s and a primary submit, capped at `max-w-sm` (`:86-136`).
  - The failure sentence is **the same generic one every other auth failure uses**: a wrong current password must not be distinguishable from a rejected new one (SEC-1).
  - The id is the anchor the shell's account menu links straight to, so it is part of that control's contract rather than decoration; the other two ids were written to match it (`lib/settings-sections.ts`).
- **Two-factor `section`** (`id="two-factor"`): an `h2`, then the enrollment state as **prose, not an `alert`** - the vendored `Alert` is a live region, and this is standing state rather than something that just happened, so as an `alert` it announced itself on every visit and competed with the real password-change message (`:138-164`).
  - **Only for an enrolled account**, and beneath the same heading: an `h3` `Recovery codes`, a generic error `alert` when the address carries `?codesError`, the intro sentence, and a second `method="post"` `form` to `/settings/recovery-codes` with one password `text-field` and a secondary submit (`:168-202`). It is offered only when a factor exists, because better-auth refuses to generate codes without one and a control that can only fail is worse than no control.
- Each of the three is a real `<section>` carrying the id its rail row points at, labelled by its own `h2` through `aria-labelledby`, and carrying `tabIndex={-1}` so following a rail row moves **focus** into the section rather than only scrolling to it (`:34-47`).
- **Nothing else, and the "nothing else" binds.** No profile, no preferences, no user list, no roles, no session list, no theme control (appearance is the shell's chrome, not this screen's). RBAC is Phase 4 (R7).

## States (normative) - Settings

- **signed in** - the three sections, the rail, no message.
- **password changed** (`?changed`) - the success `alert` above the form; this session survives and every other one is gone.
- **password refused** (`?error`) - the generic `alert`; nothing distinguishes a wrong current password from a rejected new one.
- **2FA on** - the success-coloured sentence, and the recovery-codes form beneath it.
- **2FA off** - the warning-coloured sentence, and **no** recovery-codes form.
- **recovery-code regeneration refused** (`?codesError`) - the same generic `alert`, beside the regeneration form.
- **recovery-codes display** - the one-time screen the regeneration lands on. It is an auth screen and is inventoried above, not here: this screen redirects to it and never renders codes itself.
- **a section targeted** - the rail row and the section are both marked, and focus is inside the section.
- **no section targeted** - no rail row is marked, and the collapsed summary reads `Sections`.

## Interactions - Settings

- Arrive → the shell nav's Settings item, or the account menu's **Change password** item, which links to `/settings#change-password`.
- Change password → `POST /settings/password` → 303 back to `/settings?changed=1`, or to `/settings` with the generic failure marker. **Every other session is invalidated** (SEC-1) and this one is not, which is both the requirement and the useful behaviour. The handler is a `route.ts`, so the `(shell)` layout never runs for it and it guards itself (issue #177).
- Regenerate recovery codes → `POST /settings/recovery-codes` → the one-time display at `/two-factor/recovery-codes`, or back to `/settings?codesError=1`. Password-gated, so a borrowed session cannot retire an admin's codes.
- Both posts are same-origin-checked before anything else, and both are plain form posts: no client JavaScript is involved in any credential transition here.
- **2FA re-enrollment is a sign-out**, and the honesty of that is the point: provisioning a new TOTP secret needs the password, this screen has none to offer, and rather than add a second password prompt duplicating the sign-in screen, re-enrollment routes through the flow that already asks. An account that already has a live factor must first disable it, which this launch surface deliberately does not expose.
- Rail rows are fragment navigations on this route. No request, no re-render.

## A11y notes - Settings

- One `h1` and three `h2`s, with the recovery-codes `h3` under the two-factor `h2`: no level is skipped.
- Each section is named by its own heading through `aria-labelledby`, so a screen reader moving between rail rows is told which region it landed in.
- The rail is a `navigation` landmark named `Settings sections`, its rows are anchors, and the whole of it - disclosure, links and active mark - works with JavaScript disabled.
- The active-section mark is never colour alone (SC 1.4.1): the accent edge and weight are joined by a visually-hidden phrase in exactly one row.
- The enrollment state is prose rather than a live region, so it is not announced on every visit; the password-change outcome is the one thing on this screen that announces itself.
- Neither failure `alert` says which credential was wrong (SEC-1), and neither form field is pre-filled.
- **Known divergence:** at and above `--bp-sidebar` the rail's disclosure summary still renders as a visible label above the rail (`Sections`), which reads as a stray page title. **#648** is open on it, and names the same behaviour on the §7 rail. Recorded here so this inventory is not read as endorsing it.

Signed off: Code Owner, 2026-07-21
