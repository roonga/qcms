# Swapping admin identity for an external IdP

**Status:** pointer, not an implementation (task 031). Launch ships better-auth with
email + password and TOTP 2FA (SEC-1). This page records **where** the seams are, so an
operator who must use their own identity provider can see the shape of the work before
starting it, and so a future task does not have to rediscover it.

Nothing here is on the launch gate. OTP and social sign-in for admins are Phase 4 via the
same library (SEC-1); this document is about replacing the library.

## Why a swap is bounded at all

Two decisions from before better-auth was chosen are what keep this small, and both are
worth knowing before you touch anything:

1. **The API never links better-auth.** It authenticates an admin by resolving a session
   token to a row (`apps/api/src/middleware/admin-auth.ts` →
   `getAdminSessionByToken`). So the API does not care *which* library issued the
   session, only that a row exists, is in policy, and belongs to an account with a
   second factor.
2. **Authorization is enforced in the API layer, never in the BFF** (SEC-3, R2). So the
   admin app holds credentials and proxies; it decides nothing. Replacing the thing that
   issues credentials therefore cannot change any authorization behaviour.

`better-auth` is on CONTRIBUTING's accepted-with-noted-risk list precisely because of
this: the noted risk is a young, VC-funded project pivoting to a hosted auth cloud, and
the recorded exit path is this page.

## The three seams

### 1. The session verifier (API side)

`AdminSessionVerifier` in `apps/api/src/middleware/admin-auth.ts` is a one-function
interface: request in, `AdminPrincipal` or `undefined` out. `registerAdminAuth` wires
`betterAuthSessionVerifier` into it and nothing else in the API mentions the library.

- **Keeping your own session table:** nothing to do. A different library writing
  compatible rows works unchanged.
- **Verifying a JWT or an opaque token against an IdP introspection endpoint:** write a
  second verifier and swap the one line in `registerAdminAuth`. It must stay fetch-pure
  (R4) - use WebCrypto, not `node:crypto` - and it must keep the current rejection
  contract: **every** failure returns `undefined`, so the 401 carries no reason (SEC-1's
  no-enumeration rule is enforced at that boundary, not in the handler).
- The principal's `role` claim (SEC-3) is where an IdP's group or role mapping lands.
  Launch issues a single `admin` value and nothing branches on it, so a mapping can be
  added without touching a route.

### 2. The auth instance and the screens (admin side)

`apps/admin/lib/server/auth.ts` is the only file that constructs better-auth.
`apps/admin/lib/server/session.ts` is the only file that reads a session. Everything
else - the sign-in screen, the 2FA screens, sign-out - is a form POST to a route handler
under `apps/admin/app/`.

An OIDC swap replaces the screens with a redirect to the provider and a callback route,
and replaces `currentAdminSession()` with a read of whatever the provider's SDK stores.
Two rules survive the swap:

- **The BFF still forwards the user's own credential to the API** on the admin-session
  header (SEC-4). Whatever the new session is, the API must be able to verify it: seam 1
  and seam 2 have to be replaced together.
- **No self-registration path may appear.** better-auth's catch-all handler is
  deliberately not mounted today for exactly this reason (see the file header), and an
  IdP swap must not mount an equivalent. If the IdP creates accounts on first sign-in,
  that is a provisioning policy decision to record, not a default to inherit.

### 3. The tables and the bootstrap

`packages/db/src/schema/auth.ts` owns the auth tables and the migration history. An
external IdP that holds identity itself makes `user`/`account`/`twoFactor` unused, but
**a session table is still the API's verification surface** unless seam 1 is replaced with
token introspection.

`pnpm qcms:create-admin` (`apps/admin/lib/server/bootstrap.ts`) exists because there is
no other way to create the first account. Under an IdP the first admin is whoever the IdP
says, so the command becomes unnecessary - but it must not simply be deleted while the
better-auth path still exists in any supported composition.

## What a swap must not change

- **2FA is not optional.** `QCMS_ADMIN_2FA=optional` is a development escape hatch
  (SEC-1) and an IdP swap is not a reason to set it in production. If the IdP enforces
  MFA itself, the verifier's second-factor check becomes "the IdP asserted MFA", not
  "skip the check".
- **Session lifetimes.** 12h absolute, 1h idle, invalidated server-side on sign-out and
  password change (SEC-1). The absolute cap is measured from issue in both the API
  middleware and `session.ts`; an IdP whose tokens live longer needs its own cap, not a
  relaxed one.
- **No CORS, ever.** The BFF pattern eliminates cross-origin access (SEC-9). An IdP SDK
  that wants a browser-side token exchange against the API is the wrong integration
  shape here.
- **Answer values are never logged** and secrets are never echoed (SEC-8). An IdP SDK's
  default debug logging is the usual way this gets broken.

## Verification

Whatever replaces these seams has to keep the existing tests honest, and they are the
checklist:

- `apps/api/src/middleware/admin-auth.integration.test.ts` - the 401 contract, the
  lifetime policy, the 2FA policy, the role claim.
- `apps/admin/lib/server/no-self-registration.test.ts` - the route tree carries no
  registration path and no catch-all.
- `apps/admin/lib/server/r2-import-surface.test.ts` - the BFF stayed a proxy.
- `apps/admin/e2e/auth-2fa.pw.ts` - the browser loop, including the second factor.

A swap that cannot keep all four green has changed a security property, not an
implementation detail.
