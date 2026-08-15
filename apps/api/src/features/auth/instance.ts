import { authAccount, authSession, authTwoFactor, authUser, authVerification } from "@qcms/db";
import type { Executor } from "@qcms/db";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, isAPIError } from "better-auth/api";
import { haveIBeenPwned } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { Config } from "../../config.js";
import type { Logger } from "../../logger.js";

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
 *
 * Both stored factors are **ciphertext under the admin auth secret**: the TOTP secret
 * (`dist/plugins/two-factor/index.mjs:106`) and the recovery codes
 * (`.../backup-codes/index.mjs:19-22`). That used to make `QCMS_ADMIN_AUTH_SECRET` a
 * key nobody could change without destroying every enrolment, which task 056 recorded
 * as permanent. It is not permanent any more: better-auth 1.6.26 carries a versioned
 * key set (`secrets`) and writes a `$ba$<version>$` envelope, so an operator adds a new
 * version, keeps the old one for reading, and stored material re-encodes under the
 * current version as it is used. Recovery-code blobs re-encode on **every redemption**
 * (`.../backup-codes/index.mjs:215`). `docs/operations.md` carries the runbook, and
 * §4 of `docs/SECURITY_DESIGN.md` carries what it does and does not reach.
 *
 * Rotation is still not free of consequence, and the runbook says so: better-auth
 * derives its cookie-signing secret from the *current* version
 * (`dist/context/create-context.mjs:73`), so promoting a new version signs every live
 * admin out. That is the correct trade for a key change and is a world away from what
 * it replaced, which was every authenticator dying with no way back in.
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

/**
 * What SEC-1's sign-in throttle is actually doing in this process (issue #390).
 *
 * ## Why this exists
 *
 * The throttle is better-auth's. Until issue #390 whether it ran was decided by
 * `NODE_ENV`: read against better-auth 1.6.26, the pinned version,
 * `dist/context/create-context.mjs:171` resolves it as
 * `options.rateLimit?.enabled ?? isProduction`, and `isProduction` is a module-scope
 * `const` in `@better-auth/core/dist/env/env-impl.mjs:32` (`nodeENV === "production"`,
 * over a `nodeENV` captured at `:30` on that module's first import). So the state of a security
 * control was decided, once and before any request arrived, by a general-purpose
 * variable that nothing about the running process reported.
 *
 * `createAdminAuth` above now passes `rateLimit.enabled` from
 * `QCMS_ADMIN_SIGNIN_THROTTLE` (default **on**), which takes that `??` branch away, so
 * `NODE_ENV` no longer participates in either direction. That is the decision half of
 * #390; this function is the reporting half, and the pairing is the point. The one
 * remaining way to serve an unthrottled sign-in surface is to set the escape hatch
 * false, and setting it false is exactly what makes the warn line below fire, so the
 * guard's failure mode is one its own detector can see.
 *
 * ## Read back, never echoed
 *
 * Every field comes from `await auth.$context`, which is the object the limiter itself
 * consults: in better-auth 1.6.26, `dist/api/rate-limiter/index.mjs:333` gates on
 * `ctx.rateLimit.enabled`, and
 * `getIp` (`@better-auth/core/dist/utils/ip.mjs:204`) reads the header list off
 * `ctx.options.advanced.ipAddress`. Reporting the options this file passes in instead
 * would report what was asked for, which is exactly the thing already known and exactly
 * the thing that can be wrong.
 *
 * There is a **second** way the vendor leaves the sign-in surface unlimited that is not
 * reported here: `advanced.ipAddress.disableIpTracking` makes `resolveRateLimitConfig`
 * return `null` for a caller whose address does not resolve, and the check is skipped.
 * It is absent because the type system proves it cannot be true - `ctx.options` is the
 * literal options object built below, and `disableIpTracking` is not a property of it,
 * so reading it back would not compile. A future edit that adds the option has to widen
 * {@link SignInThrottleState} with it, and will be told so by `tsc`.
 *
 * ## What is deliberately not in here
 *
 * The **numbers**. In better-auth 1.6.26 the sign-in rule is three attempts per ten
 * seconds (`getDefaultSpecialRules`, `dist/api/rate-limiter/index.mjs:370-377`, matching
 * `/sign-in`, `/sign-up`, `/change-password` and `/change-email`), and the two-factor
 * plugin adds the same shape for `/two-factor/*`
 * (`dist/plugins/two-factor/index.mjs:314-320`). Neither is reachable from the resolved
 * context: both are module-private to the vendor. Restating them here would be an
 * inference printed as an observation, which is the failure mode this whole function
 * exists to avoid, so they stay in this comment where a reader can see them sourced.
 */
export interface SignInThrottleState {
  /**
   * Whether a sign-in POST to this process can be refused with a 429: `rateLimit.enabled`
   * as better-auth resolved it, which since issue #390 is `QCMS_ADMIN_SIGNIN_THROTTLE`
   * as this configuration passed it in. The one field an operator needs.
   */
  readonly enabled: boolean;
  /**
   * The headers the limiter resolves a caller's address from, in order, as
   * `getIp` reads them (better-auth 1.6.26, the pinned version:
   * `@better-auth/core/dist/utils/ip.mjs:204`). Header
   * **names**, never a value: an address identifies a person and SEC-8 and
   * SEC-13 keep it out of a log line, which is why this reports where the
   * limiter looks rather than what it found.
   */
  readonly addressHeaders: readonly string[];
}

/** The boot line when the throttle is running. */
export const SIGN_IN_THROTTLE_ACTIVE_MESSAGE = "sign-in throttling active";

/**
 * The boot line when it is not, written for an operator who has to act on it: what is
 * off, what that costs, why it is off, and what decides it. Long for the same reason
 * {@link BREACH_CHECK_DISABLED_WARNING} is long: it is read once, by someone who did not
 * write it, at the moment it matters.
 */
export const SIGN_IN_THROTTLE_INACTIVE_WARNING =
  "sign-in throttling is NOT running in this process: the admin sign-in, change-password " +
  "and two-factor endpoints have no brute-force limiter (SEC-1). This is on by default " +
  "and something switched it off: QCMS_ADMIN_SIGNIN_THROTTLE is set to a false value in " +
  "this environment. It is a development escape hatch, so unset it here unless this " +
  "deployment is meant to serve an unlimited admin sign-in surface. See " +
  "docs/operations.md.";

/**
 * Read the effective state off better-auth's resolved context.
 *
 * Awaiting `$context` forces the instance to finish initialising, which is why the
 * caller is the composition root rather than a request path: by the time an admin
 * signs in this has long since resolved.
 */
export async function readSignInThrottleState(auth: AdminAuth): Promise<SignInThrottleState> {
  const ctx = await auth.$context;
  return {
    enabled: ctx.rateLimit.enabled,
    addressHeaders: ctx.options.advanced.ipAddress.ipAddressHeaders,
  };
}

/**
 * Emit exactly one line saying whether the throttle is running, and answer the state so
 * a caller (or a test) can compare it against what the limiter actually does.
 *
 * A line in **both** directions, unlike the breach-check warning above, which is silent
 * when the control is on. The difference is what the two questions are: "has someone
 * turned this off" is answered by a warning, and "is this on" - which is what issue #390
 * asks and what nothing in the running system could answer - needs a line even when the
 * answer is yes.
 *
 * `addressHeaders` is joined into a scalar rather than logged as an array so it survives
 * the OTel export path, which takes string, number and boolean fields only.
 */
export async function logSignInThrottleState(
  auth: AdminAuth,
  logger: Pick<Logger, "info" | "warn">,
): Promise<SignInThrottleState> {
  const state = await readSignInThrottleState(auth);
  const fields = {
    enabled: state.enabled,
    addressHeaders: state.addressHeaders.join(","),
  };
  if (state.enabled) logger.info(SIGN_IN_THROTTLE_ACTIVE_MESSAGE, fields);
  else logger.warn(SIGN_IN_THROTTLE_INACTIVE_WARNING, fields);
  return state;
}

/**
 * The error code better-auth's `haveIBeenPwned` plugin puts in the body of the 400 it
 * answers a corpus hit with. A code, not the message: the message is prose the vendor
 * may reword, the code is the contract (its `$ERROR_CODES` entry).
 */
export const CORPUS_HIT_CODE = "PASSWORD_COMPROMISED";

/**
 * The code this shell puts on a refusal caused by the corpus **lookup** failing rather
 * than by the password. First-party, so callers match on a value this repository owns
 * rather than on vendor prose.
 */
export const BREACH_LOOKUP_FAILED_CODE = "BREACH_CORPUS_UNREACHABLE";

/**
 * What that refusal says. Written to be read in a CI log by someone whose change had
 * nothing to do with passwords: the first sentence names the cause, the second denies
 * the wrong hypothesis outright, and the third is the action.
 */
export const BREACH_LOOKUP_FAILED_MESSAGE =
  "The SEC-1 breach-corpus lookup to api.pwnedpasswords.com did not complete, so this " +
  "password was refused without ever being compared against the corpus. This is a " +
  "network failure, not an authentication failure and not a judgement about the " +
  "credential: the check fails closed by design. Restore egress to " +
  "api.pwnedpasswords.com and retry, or set QCMS_ADMIN_PASSWORD_BREACH_CHECK=false for " +
  "a deployment that has none (docs/operations.md).";

/**
 * Turn the vendor's opaque 500 into a refusal that names the network (issue #436).
 *
 * `haveIBeenPwned` collapses every non-corpus-hit outcome of its lookup into
 * `APIError("INTERNAL_SERVER_ERROR", { message: "Failed to check password. ..." })`.
 * That is a fine failure and the *right* one - refusing a password it could not check
 * is fail-closed, which stays - but as a report it is a dead end: what an operator (or
 * the `full-stack-e2e` log of a pull request about something else entirely) sees is a
 * 500 out of sign-up, and the first hypothesis that reading produces is that
 * authentication is broken.
 *
 * So the translation is by **status and code, never by message text**. The vendor's
 * wrapper around `ctx.password.hash` does exactly three things - SHA-1 the password,
 * fetch the range, compare the suffix - so an `APIError` out of it that is not the
 * corpus-hit 400 can only be the lookup failing. A plain `Error` (the underlying
 * hash itself failing) is not an `APIError` and passes through untouched, so nothing
 * unrelated gets blamed on the network.
 *
 * The status becomes 503: an upstream this process depends on was unavailable, which
 * is what "Service Unavailable" means and what "Internal Server Error" does not.
 */
export function explainBreachLookupFailure(error: unknown): unknown {
  if (!isAPIError(error)) return error;
  if (error.status !== "INTERNAL_SERVER_ERROR") return error;
  const code: unknown = (error.body as { code?: unknown } | undefined)?.code;
  if (code === CORPUS_HIT_CODE) return error;
  return new APIError("SERVICE_UNAVAILABLE", {
    message: BREACH_LOOKUP_FAILED_MESSAGE,
    code: BREACH_LOOKUP_FAILED_CODE,
  });
}

/** The `init` argument better-auth hands a plugin, without restating its type. */
type PluginInitContext = Parameters<NonNullable<BetterAuthPlugin["init"]>>[0];

/**
 * A first-party plugin that wraps the password hash **after** `haveIBeenPwned` has
 * wrapped it, so it sees that plugin's refusals and can relabel the network one.
 *
 * Order is the whole mechanism and is load-bearing: better-auth runs plugin `init`
 * hooks in array order and `Object.assign`s each returned context over the running one
 * (`context/helpers.ts`, `runPluginInit`), so the `hash` this captures is the vendor's
 * checked hash only while this entry sits *after* `haveIBeenPwned` in `plugins`.
 * Listed before it, this would wrap the bare hash and see nothing.
 *
 * It changes what is reported and nothing about what is enforced: every path that
 * refused a password before still refuses it, with the same fail-closed behaviour.
 */
const breachLookupDiagnostics: BetterAuthPlugin = {
  id: "qcms-breach-lookup-diagnostics",
  init(ctx: PluginInitContext) {
    const checkedHash = ctx.password.hash;
    return {
      context: {
        password: {
          ...ctx.password,
          hash: async (password: string): Promise<string> => {
            try {
              return await checkedHash(password);
            } catch (error) {
              throw explainBreachLookupFailure(error);
            }
          },
        },
      },
    };
  },
};

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
    // The **versioned** key set, and `secret` beside it as the legacy fallback
    // (issue #319). better-auth 1.6.26 resolves these together in
    // `dist/context/create-context.mjs:69-81`: with `secrets` present it builds a
    // `SecretConfig` whose current version encrypts, whose whole map decrypts, and
    // whose `legacySecret` is `secret` - used only for ciphertext that predates the
    // `$ba$<version>$` envelope. That is what makes rotating this key a rotation
    // rather than a break: see the header note above.
    //
    // `secrets` defaults to one version-1 entry holding exactly `secret`, so a
    // deployment that has never rotated signs and encrypts with the same value it
    // always did. Only the stored *format* moves, and only forwards.
    secrets: adminAuth.secrets.map((entry) => ({ ...entry })),
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
    // SEC-1's brute-force throttle on sign-in, change-password and two-factor, stated
    // rather than inferred (issue #390).
    //
    // better-auth 1.6.26, the pinned version, resolves this as
    // `options.rateLimit?.enabled ?? isProduction`
    // (`dist/context/create-context.mjs:171`), and `isProduction` is
    // `nodeENV === "production"` over a `NODE_ENV` captured once when
    // `@better-auth/core/dist/env/env-impl.mjs` is first imported (`:30-32`). Passing a
    // value here takes the `??` branch away, so the state of a security control is no
    // longer decided by a general-purpose variable that people set, and forget to set,
    // for unrelated reasons. Nothing else about the limiter changes: `window`, `max`
    // and `storage` keep the vendor defaults (`:172-174`), and the sign-in allowance is
    // still `getDefaultSpecialRules`' three attempts per ten seconds
    // (`dist/api/rate-limiter/index.mjs:370-377`).
    //
    // `adminAuth.signInThrottle` defaults to **true**, so a deployment that configures
    // nothing is throttled. It is a whole boolean rather than an "is this development"
    // predicate on purpose: a predicate wrong in the direction `NODE_ENV` is wrong
    // today would quietly stop protecting production while every diagnostic still read
    // as healthy, which is worse than the bug being fixed here.
    //
    // Read back off `$context` by `readSignInThrottleState` below, which is what keeps
    // the guard and its detector aligned: turning this off makes `ctx.rateLimit.enabled`
    // false, and the boot line warns.
    rateLimit: { enabled: adminAuth.signInThrottle },
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
        backupCodeOptions: {
          // Recovery codes are ciphertext at rest, under the versioned key set above
          // (issue #319, SEC-7).
          //
          // This restates better-auth 1.6.26's own default rather than changing it:
          // `dist/plugins/two-factor/index.mjs:25-27` builds `backupCodeOptions` as
          // `{ storeBackupCodes: "encrypted", ...options?.backupCodeOptions }`, so
          // an instance that passes nothing already encrypts. Verified against the
          // stored column rather than read off the type, in
          // `backup-code-storage.integration.test.ts`.
          //
          // It is written down for the same reason `skipVerificationOnEnable` is:
          // this is a security property of the deployment, and an upstream default
          // flip would otherwise weaken it silently and invisibly. Issue #319 exists
          // because a reviewer read the *decoder* (`backup-codes/index.mjs:45`,
          // which does plain-JSON parse when the option is absent) without reading
          // the caller that supplies it, and concluded the codes sat in plaintext.
          // Stating the value is what makes that question answerable from this file.
          storeBackupCodes: "encrypted",
        },
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
      // the suffix in this process. The password never leaves the process, and the
      // five-character prefix is all the endpoint learns: about two thousand corpus
      // entries share any one range (measured 2026-08-09 across six prefixes: 1921 to
      // 2509 entries, unpadded), and vastly more possible passwords than that do, so
      // the request tells the endpoint nothing usable (SEC-8).
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
      // Immediately after `haveIBeenPwned`, and only useful there: it wraps whatever
      // `password.hash` is at its turn, and the vendor's checked hash is what that is
      // at this position. See the plugin's own note (issue #436). Fail-closed is
      // untouched; the refusal just stops reading like an authentication failure.
      breachLookupDiagnostics,
    ],
  });
}
