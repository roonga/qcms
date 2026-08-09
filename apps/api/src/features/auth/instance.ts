import { authAccount, authSession, authTwoFactor, authUser, authVerification } from "@qcms/db";
import type { Executor } from "@qcms/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { haveIBeenPwned } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { Config } from "../../config.js";

/**
 * better-auth, configured in owned shell code (ADR-06, SECURITY_DESIGN §2.1 SEC-1).
 *
 * Task 056 moved this instance out of the admin app and into the API (ADR-35 as
 * amended 2026-07-31): after that move exactly one process holds a database
 * connection, and the admin is a pure BFF for auth traffic as well as for domain
 * data. Nothing about the *policy* changed in the move - every decision below is
 * 031's, carried over with its reasoning - so a diff of this file against
 * `apps/admin/lib/server/auth.ts` at `dc40a83` should show configuration values
 * that are identical and a database handle that arrives as an argument.
 *
 * ## Where it is reachable, and how it is reached
 *
 * Mounted at `/api/auth/*` inside a route group that (a) sits behind the SEC-4
 * internal service token like every other group and (b) refuses any endpoint not on
 * an explicit allowlist. The browser never talks to it: it talks to the admin
 * origin, whose named BFF route handlers forward one operation each and re-emit the
 * resulting `Set-Cookie` headers on their own redirect. So the cookies stay
 * first-party to the admin origin and no CORS surface exists anywhere.
 *
 * ## What is deliberately NOT here
 *
 * **A bare catch-all.** better-auth's documented Hono integration mounts one handler
 * for the whole endpoint set, which as a side effect publishes
 * `POST /api/auth/sign-up/email` - a self-registration path, and SEC-1 requires that
 * "no self-registration path exists in any composition". The mount keeps the vendor's
 * handler shape and puts an endpoint allowlist in front of it, so sign-up is a 404 in
 * every composition. `route.ts` owns that list and `auth-mount.test.ts` pins it.
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
 * it is enforced where the session is read - the admin's `currentAdminSession()` and
 * the `admin-auth` middleware here - both measuring from `session.createdAt`, which
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
 * better-auth app cannot collide with this one. Unchanged by the move to the API:
 * the cookies are still set on the admin origin, and renaming them would have
 * signed out every live admin for no reason.
 */
const COOKIE_PREFIX = "qcms_admin";

/** The name of the session cookie better-auth issues, derived from the prefix. */
export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;

/** The name of the short-lived cookie that carries a pending 2FA challenge. */
export const TWO_FACTOR_COOKIE = `${COOKIE_PREFIX}.two_factor`;

/**
 * better-auth's base path, and therefore the prefix this instance strips from an
 * inbound request path. It has to match the mount prefix in `app.ts` exactly, or the
 * library resolves every request to an unknown endpoint.
 */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * Minimum admin password length (SEC-1). Length is the only *composition-shaped* rule
 * here, and deliberately so: NIST SP 800-63B Rev 4 section 3.1.1.2 says a verifier
 * SHALL NOT impose composition rules, and OWASP ASVS 5.0 6.2.5 says the same. The
 * control the standards actually mandate is the breach-corpus check below.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The one line an operator must be able to find in a log when the breach check is
 * off. Exported so the test that pins it and the two entry points that emit it read
 * the same string.
 */
export const BREACH_CHECK_DISABLED_WARNING =
  "QCMS_ADMIN_PASSWORD_BREACH_CHECK is false: admin passwords are NOT checked against " +
  "the public breach corpus. This is a documented downgrade against NIST SP 800-63B " +
  "Rev 4 section 3.1.1.2 and OWASP ASVS 5.0 6.2.12 (SEC-1), supported only for a " +
  "deployment with no egress to api.pwnedpasswords.com.";

/**
 * Emit {@link BREACH_CHECK_DISABLED_WARNING} when the check is off, and nothing when
 * it is on.
 *
 * A plain `(message: string) => void` sink rather than the `Logger` interface, because
 * the two callers are a server with a structured logger and a CLI with a stderr
 * stream, and the only thing they have in common is "somewhere an operator reads".
 * Silence when the check is on is the point: a line per boot saying a control is
 * working is a line nobody reads, which is the same failure mode as the fail-open
 * warning this design rejected.
 */
export function warnIfBreachCheckDisabled(
  adminAuth: Pick<Config["adminAuth"], "breachedPasswordCheck">,
  warn: (message: string) => void,
): void {
  if (!adminAuth.breachedPasswordCheck) warn(BREACH_CHECK_DISABLED_WARNING);
}

/** What {@link createAdminAuth} needs: a database handle and the auth config. */
export interface AdminAuthInput {
  readonly db: Executor;
  readonly adminAuth: Config["adminAuth"];
}

/** The configured better-auth instance type, so callers need not restate it. */
export type AdminAuth = ReturnType<typeof createAdminAuth>;

/**
 * Build the configured instance. Takes its collaborators as arguments rather than
 * reading the environment, so the composition root, the OpenAPI generator, the
 * integration tests and the bootstrap CLI all get the same object from the same
 * code path.
 */
export function createAdminAuth(input: AdminAuthInput) {
  const { adminAuth } = input;
  return betterAuth({
    database: drizzleAdapter(input.db, {
      provider: "pg",
      // Explicit model-to-table mapping: `@qcms/db`'s exported names are prefixed
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
    secret: adminAuth.secret,
    // The ADMIN app's public origin, not this API's. The browser only ever sees the
    // admin, so that is the origin the cookies belong to and the one better-auth
    // must treat as trusted; the vendor options reference recommends configuring it
    // explicitly rather than inferring it from a request behind a proxy.
    baseURL: adminAuth.baseUrl,
    basePath: AUTH_BASE_PATH,
    // Stated rather than inherited from `baseURL`, so a future change to how the
    // admin's origin is derived cannot silently widen what better-auth accepts as a
    // same-origin request (its CSRF check reads this list).
    trustedOrigins: [adminAuth.baseUrl],
    // No phone-home. better-auth's telemetry is opt-in upstream; saying so
    // explicitly means an upstream default flip cannot quietly turn it on.
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      // A floor, not a strength model: the blocklist plugin below is the control the
      // standards mandate, and 040 verifies SEC-1 as a system.
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // No reset mail exists (see the header), so do not advertise one.
      requireEmailVerification: false,
    },
    session: {
      expiresIn: Math.floor(adminAuth.idleMs / 1000),
      // Refresh at most once per quarter of the idle window: enough that an active
      // admin is never logged out mid-task, few enough that a busy session is not
      // writing to the session row on every request.
      updateAge: Math.floor(adminAuth.idleMs / 4000),
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
      // The address SEC-1's per-IP sign-in throttling keys on comes from the admin BFF
      // and nowhere else (issue #374). better-auth's default is `["x-forwarded-for"]`,
      // which at this process means "whatever the browser sent, relayed": the BFF used
      // to forward that header verbatim, so a caller rotating it bought a fresh backoff
      // bucket every attempt. Naming the vouched header instead puts the auth throttle
      // on the same trust model as every other per-address limit here
      // (`src/client-address.ts`, issue #341): the BFF resolves one address by counting
      // trusted hops from the right of its own inbound chain and asserts it over the
      // SEC-4 internal-token channel, and `X-Forwarded-For` at this process - which
      // never faces the internet, ADR-20 - is ignored.
      //
      // With no vouched address better-auth resolves none and every caller shares its
      // `no-trusted-ip` bucket. Coarse, and deliberately so: that is the failure this
      // configuration can have, and it is the closed one, never a bucket per request.
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
      // `Secure` outside development, so local http development still works (ADR-20:
      // TLS terminates at the operator's ingress, and local eval runs plain http).
      // A config value rather than a `NODE_ENV` read, because the flag describes the
      // browser-facing origin's scheme and this process cannot see it.
      useSecureCookies: adminAuth.secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        // SameSite=Lax is the primary CSRF control (SEC-9); the admin's BFF route
        // handlers add an Origin/Sec-Fetch-Site check on top for older clients.
        sameSite: "lax",
        path: "/",
      },
    },
    plugins: [
      twoFactor({
        // What an authenticator app displays next to the account. The product name
        // only: an operator's authenticator shows this for years, and "admin" is not
        // part of the name (Code Owner naming call, 2026-07-30).
        issuer: "QCMS",
        // Enrollment must be confirmed by a real TOTP code before the account counts
        // as protected; this is better-auth's default and is restated because
        // flipping it would silently weaken SEC-1.
        skipVerificationOnEnable: false,
      }),
      // SEC-1's breach-corpus check (issue #178). NIST SP 800-63B Rev 4 section
      // 3.1.1.2 says a verifier SHALL compare a prospective secret against a list of
      // known compromised passwords, and OWASP ASVS 5.0 6.2.12 requires the same at
      // L2. Neither asks for an entropy score, which is what SEC-1 used to promise.
      //
      // First-party: `haveIBeenPwned` ships inside the pinned better-auth and is
      // re-exported from `better-auth/plugins`, so no package entered the tree. What
      // *is* new is an operational dependency: a k-anonymity lookup that sends the
      // first five hex characters of the password's SHA-1 to
      // `api.pwnedpasswords.com/range/{prefix}` with `Add-Padding: true` and matches
      // the suffix in this process. The password never leaves the process, and 2^15
      // hashes share any one prefix, so the request tells the endpoint nothing usable
      // (SEC-8).
      //
      // It hooks `ctx.password.hash`, so it covers every path that sets a password
      // rather than one call site. Both of ours are in the vendor's default `paths`:
      // `/change-password` over the mount, and `/sign-up/email` called in process by
      // `bootstrap.ts`. Traced, not inferred (issue #178): an in-process
      // `auth.api.signUpEmail` does populate `getCurrentAuthContext().path`, the
      // lookup goes out, and a corpus hit comes back as a 400 `PASSWORD_COMPROMISED`.
      // `paths` is deliberately left at its default: the seven defaults already cover
      // both, the other five are unreachable behind `route.ts`'s allowlist, and the
      // option is absent from the vendor's documentation site, so pinning it would
      // couple this configuration to undocumented surface.
      //
      // **Fail-closed, kept from the vendor.** An unreachable endpoint refuses the
      // password rather than waving it through. That is acceptable because neither
      // caller is on a critical path that cannot be retried: `qcms:create-admin` is
      // run-once and re-runnable, and change-password is retryable. Fail-open-with-a-
      // warning was considered and rejected, because a warning nobody reads turns a
      // SHALL into a sometimes. A deployment that is *structurally* offline sets
      // `QCMS_ADMIN_PASSWORD_BREACH_CHECK=false` instead: a config-plane decision the
      // deployer makes and a reviewer can see, rather than a runtime bypass. That
      // knob is also the break-glass for the one case fail-closed genuinely costs an
      // operator something, rotating a leaked password while the corpus is
      // unreachable mid-incident.
      haveIBeenPwned({ enabled: adminAuth.breachedPasswordCheck }),
    ],
  });
}
