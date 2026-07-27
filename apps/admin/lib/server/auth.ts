import { authAccount, authSession, authTwoFactor, authUser, authVerification } from "@qcms/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";

import {
  MIN_PASSWORD_LENGTH,
  adminBaseUrl,
  authSecret,
  isProduction,
  sessionPolicy,
  twoFactorPolicy,
} from "./config.ts";
import { adminDb } from "./db.ts";

/**
 * better-auth, configured in owned shell code (ADR-06, SECURITY_DESIGN §2.1
 * SEC-1). Server-only: never imported by a client component.
 *
 * ## What is deliberately NOT here
 *
 * **The catch-all handler.** better-auth ships a `/api/auth/[...all]` route you
 * mount to expose its whole endpoint set over HTTP. This app does not mount it, and
 * that is a security decision rather than a simplification: mounting it would
 * publish `POST /api/auth/sign-up/email`, which is a self-registration path, and
 * SEC-1 requires that "no self-registration path exists in any composition". Every
 * flow the admin needs is reached instead through a named BFF route handler that
 * calls `auth.api.*` in process, so the surface is exactly the set of routes under
 * `app/` and nothing else. `lib/server/no-self-registration.test.ts` pins that.
 *
 * **Email.** No verification mail, no password-reset mail, no OTP delivery: the
 * launch admin surface has one account created by `pnpm qcms:create-admin` and a
 * recovery-code path for a lost authenticator. An admin who loses both re-runs the
 * CLI. Wiring a mailer is a deployment concern the launch cut-line does not carry.
 *
 * **Social and OTP providers.** Phase 4 (SEC-1), via the same library. The
 * external-IdP swap recipe is `docs/auth-swap.md`.
 *
 * ## Session policy (SEC-1)
 *
 * `expiresIn` is the **idle** window (1h by default): better-auth stamps
 * `session.expiresAt` at that distance and pushes it forward when a session is used
 * after `updateAge`. The **absolute** 12h cap is not expressible in this config, so
 * it is enforced where the session is read - `requireAdminSession()` here and the
 * admin-auth middleware in the API - both measuring from `session.createdAt`, which
 * a refresh leaves alone.
 *
 * ## 2FA
 *
 * The `twoFactor` plugin holds back the session on sign-in when an account has
 * enrollment complete: `signInEmail` answers `{ twoFactorRedirect: true }` and sets
 * only a short-lived two-factor cookie, so a password alone never yields a session
 * (which is what makes the API's "session row exists" check meaningful). Enrollment
 * is a two-step provision-then-verify: `enableTwoFactor` stores the secret and
 * backup codes but leaves `user.twoFactorEnabled` false until a real TOTP code
 * verifies, so an abandoned enrollment cannot leave an account half-protected.
 */

/**
 * Cookie prefix. QCMS-named rather than better-auth's default so an operator
 * reading a browser's cookie jar sees whose cookie it is, and so a co-hosted
 * better-auth app cannot collide with this one.
 */
const COOKIE_PREFIX = "qcms_admin";

/** The name of the session cookie better-auth issues, derived from the prefix. */
export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;

/** The name of the short-lived cookie that carries a pending 2FA challenge. */
export const TWO_FACTOR_COOKIE = `${COOKIE_PREFIX}.two_factor`;

/**
 * The instance is built **lazily and memoized**, not at module load, and that is
 * load-bearing rather than stylistic: `next build` imports every page module to
 * collect route data, so a top-level `betterAuth({...})` would demand
 * `DATABASE_URL` and `QCMS_ADMIN_AUTH_SECRET` at *build* time and make
 * `pnpm build` fail in CI, where no database exists. Configuration is read on the
 * first request instead, which is also where a misconfiguration should surface.
 */
let instance: ReturnType<typeof buildAuth> | undefined;

function buildAuth() {
  const policy = sessionPolicy();
  return betterAuth({
  database: drizzleAdapter(adminDb(), {
    provider: "pg",
    // Explicit model-to-table mapping: this package's exported names are prefixed
    // (`authUser`) to keep them apart from the domain tables, while better-auth
    // addresses its models unprefixed. Without the map the adapter would look for
    // tables named after its own models and find nothing.
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
      twoFactor: authTwoFactor,
    },
  }),
  secret: authSecret(),
  baseURL: adminBaseUrl(),
  // No phone-home. better-auth's telemetry is opt-in upstream; saying so
  // explicitly means an upstream default flip cannot quietly turn it on.
  telemetry: { enabled: false },
  emailAndPassword: {
    enabled: true,
    // Length only. SEC-1 asks for a zxcvbn-style strength score, which needs a
    // dictionary dependency and a UX for the score; it is recorded as an issue
    // rather than improvised here, and 040 verifies SEC-1 as a system.
    minPasswordLength: MIN_PASSWORD_LENGTH,
    // No reset mail exists (see the header), so do not advertise one.
    requireEmailVerification: false,
  },
  session: {
    expiresIn: Math.floor(policy.idleMs / 1000),
    // Refresh at most once per quarter of the idle window: enough that an active
    // admin is never logged out mid-task, few enough that a busy session is not
    // writing to the session row on every request.
    updateAge: Math.floor(policy.idleMs / 4000),
  },
  user: {
    additionalFields: {
      // The SEC-3 role claim, carried from day one so Phase 4 RBAC is additive.
      // `input: false` is the load-bearing part: no request body can set it, so
      // the claim cannot be self-assigned.
      role: { type: "string", required: false, defaultValue: "admin", input: false },
    },
  },
  advanced: {
    cookiePrefix: COOKIE_PREFIX,
    // `Secure` in production only, so local http development still works (ADR-20:
    // TLS terminates at the operator's ingress, and local eval runs plain http).
    useSecureCookies: isProduction(),
    defaultCookieAttributes: {
      httpOnly: true,
      // SameSite=Lax is the primary CSRF control (SEC-9); the BFF route handlers
      // add an Origin/Sec-Fetch-Site check on top for older clients.
      sameSite: "lax",
      path: "/",
    },
  },
  plugins: [
    twoFactor({
      // What an authenticator app displays next to the account.
      issuer: "QCMS admin",
      // Enrollment must be confirmed by a real TOTP code before the account counts
      // as protected; this is better-auth's default and is restated because
      // flipping it would silently weaken SEC-1.
      skipVerificationOnEnable: false,
    }),
  ],
  });
}

/** The configured better-auth instance. Built on first use, then reused. */
export function getAuth(): ReturnType<typeof buildAuth> {
  instance ??= buildAuth();
  return instance;
}

/** Whether TOTP enrollment may be skipped (development escape hatch, SEC-1). */
export function twoFactorOptional(): boolean {
  return twoFactorPolicy() === "optional";
}
