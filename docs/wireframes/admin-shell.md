# Wireframe - Admin shell, sign-in, 2FA

**Status:** Signed off: Ravi, 2026-07-21 · **Consumed by:** 031 · **Renders:** better-auth flows (031), `/admin` group auth

## ASCII sketch - authenticated shell

```
┌─ shell ─────────────────────────────────────────────┐
│ [logo] Questions Forms Responses Webhooks Settings ⏻│
│ ┌─ content ──────────────────────────────────────┐  │
│ │ (per-area screens - see sibling wireframes)    │  │
│ └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Regions (normative)

- **shell top bar**: logo slot · primary nav - Questions / Forms / Responses / Webhooks / Settings (links; active state visible) · sign-out `button` (icon + label).
- **content**: the routed area screen. Breadcrumb (`breadcrumb`) at content top on nested routes (e.g. Forms / {form} / Builder).
- **Settings** area at launch: account (change password → sessions invalidated), 2FA re-enrollment, nothing else (RBAC etc. is Phase 4).

### Auth screens (inventory-only)

- **Sign-in**: `card` - email `text-field`, password `text-field` (masked), submit `button`. Generic failure message (no user enumeration - SEC-1). Throttled state shows generic "try again later" `alert`.
- **2FA enrollment** (first sign-in, enforced by default): `card` - QR code image + manual secret (`text`, copyable), TOTP code `text-field`, verify `button`; then **recovery codes screen**: one-time display (`card`, copy-all `button`, "I have saved these" confirm `button` gates continue - codes never shown again).
- **2FA challenge** (each sign-in): TOTP code `text-field`, verify `button`, "use a recovery code" link → recovery-code `text-field` variant.
- **First-run note**: no self-registration UI exists anywhere (SEC-1); first admin via `pnpm qcms:create-admin` - sign-in screen shows nothing about registration.

## States (normative)

signed-out · sign-in error (generic) · sign-in throttled · 2FA-enroll · recovery-codes-display (one-time) · 2FA-challenge · 2FA-recovery-entry · authenticated · session-expired (redirect to sign-in with "session expired" `alert`).

## Interactions

- All auth flows through better-auth in the admin BFF (031); admin API calls carry the session (R2).
- Unauthenticated access to any admin route → redirect to sign-in. Unauthenticated `/admin` API call → 401 (middleware, 031).

## A11y notes

- Sign-in error `alert` receives focus. QR screen: manual secret is the accessible alternative to the QR image (labeled, copyable). Recovery codes announced as a list; copy-all confirmed via status text. Nav is a labeled landmark; active page `aria-current`. axe gate active from 031.

Signed off: Ravi, 2026-07-21
