# 031 — Admin shell and 2FA auth

**Stage:** 8a · **App:** `apps/admin` · **Depends on:** 027 (admin API groups), 017
**References:** `ARCHITECTURE.md` §6, §7 · ADR-06, ADR-08 · **ADR-19, ADR-22** · review resolution "admin auth hardening" · R2 · **Wireframe:** `docs/wireframes/admin-shell.md` (042)
**External input required:** the `a2-react-aria` docs (styling guide + component pages) — required reading (ADR-22). Admin kit components come from the same vendored a2ra set in `packages/ui`; vendor additions via `npx @a2ra/cli add` there, never ad hoc.

## Context

The authoring app's foundation: a second Next.js app (separate deployable for the VPN topology), better-auth sign-in with TOTP 2FA at launch, and the BFF/layout skeleton the feature tasks (032–035) fill in. Also the point where 021's auth stub becomes real.

## Deliverables

- `apps/admin` Next.js app: app-router layout (nav: Questions, Forms, Responses, Webhooks, Settings), same BFF pattern as portal (R2: session, credentials, proxying to `/admin` API group only).
- **better-auth** configured in owned shell code: email+password sign-in; **TOTP 2FA** — enrollment (QR + recovery codes) enforced-by-default with a config escape hatch (`QCMS_ADMIN_2FA=optional`) for dev; session management; sign-out. Data in the deployment's Postgres (013's tables). Document the external-IdP swap recipe stub (`docs/auth-swap.md`) — a pointer, not an implementation.
- Admin API auth middleware (replacing 021's stub): better-auth session verification for the `/admin` group; the e2e suite (027) gets a real-auth login helper.
- First-run bootstrap: with zero admin users, a CLI-or-env-driven initial admin creation flow (`pnpm qcms:create-admin` script in the shell) — documented; no open self-registration.
- Roles: launch ships a single `admin` role, but the session context carries a role claim so Phase 4 RBAC is additive (record the itch as an issue).
- Shared admin UI kit primitives (tables, forms, dialogs, alerts) built from the same vendored a2ra component set in `packages/ui` (ADR-22 — the registry already carries `table`, `dialog`, `menu`, `tabs`, `alert`; no other component library, lint-enforced per 028's rule). Admin screens are **ordinary React** on these components — A2UI documents and `A2Renderer` appear only in the preview pane (034), never for the admin's own UI. axe wired into admin CI now (030's policies inherited).
- Playwright: sign-in → 2FA enrollment → 2FA challenge → session persists → sign-out; recovery-code path.

## Exit criteria

1. Unauthenticated access to any admin page redirects to sign-in; unauthenticated `/admin` API calls 401 (middleware test).
2. 2FA Playwright flow green, including recovery code; TOTP verified with a real otplib-generated code in tests.
3. First-run bootstrap documented and tested (empty DB → create admin → sign in).
4. R2 import-surface test on admin BFF handlers.
5. axe gate active in admin CI.

## Out of scope

All feature screens (032–035), RBAC beyond the single role (issue), OTP/social respondent auth (Phase 4).
