import {
  authAccount,
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authTeam,
  authTeamMember,
  authTwoFactor,
  authUser,
  authVerification,
  clearMustChangePassword,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, isAPIError } from "better-auth/api";
import { haveIBeenPwned, organization } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { Config } from "../../config.js";
import type { Logger } from "../../logger.js";
import { accessControl, roles } from "../membership/policy.js";
import { pluginWriteBackstop } from "./plugin-write-backstop.js";

/**
 * `expiresIn` below is the idle window; the absolute 12h cap is not expressible in this
 * config, so it is enforced where a session is read, measured from `session.createdAt`.
 *
 * Both stored factors are ciphertext under the admin auth secret: the TOTP secret
 * (`dist/plugins/two-factor/index.mjs:135-138`) <!-- expect: const encryptedSecret = await symmetricEncrypt( --> and the recovery codes
 * (`.../backup-codes/index.mjs:19-22`). <!-- expect: storeBackupCodes === "encrypted" --> The versioned key set makes that key
 * rotatable: stored material re-encodes under the current version as it is used, and
 * recovery-code blobs re-encode on every redemption
 * (`.../backup-codes/index.mjs:215`). <!-- expect: encodeBackupCodes(validate.updated --> Promoting a new version also changes the
 * cookie-signing secret (`dist/context/create-context.mjs:76`), <!-- expect: secret = secretsArray[0].value --> so it signs every live
 * admin out.
 */

const COOKIE_PREFIX = "qcms_admin";

export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;

export const TWO_FACTOR_COOKIE = `${COOKIE_PREFIX}.two_factor`;

/** Must match the mount prefix in `app.ts`, or every request resolves to an unknown endpoint. */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * A literal in the library rather than a configurable name: `findCredentialAccount` looks
 * the row up with `value: "credential"`
 * (`dist/db/internal-adapter.mjs:667-684`) <!-- expect: value: "credential" -->, so the
 * `account.update.after` hook below needs it to tell that row from an OAuth account.
 */
const CREDENTIAL_PROVIDER_ID = "credential";

/**
 * The only composition-shaped rule here: NIST SP 800-63B Rev 4 section 3.1.1.2 forbids the
 * rest and mandates the breach-corpus check instead (SEC-1).
 */
export const MIN_PASSWORD_LENGTH = 12;

export const BREACH_CHECK_DISABLED_WARNING =
  "QCMS_ADMIN_PASSWORD_BREACH_CHECK is false: admin passwords are NOT checked against " +
  "the public breach corpus. This is a documented downgrade against NIST SP 800-63B " +
  "Rev 4 section 3.1.1.2 and OWASP ASVS 5.0 6.2.12 (SEC-1), supported only for a " +
  "deployment with no egress to api.pwnedpasswords.com.";

/** Silence when the check is on, so the line that does appear is one an operator acts on. */
export function warnIfBreachCheckDisabled(
  adminAuth: Pick<Config["adminAuth"], "breachedPasswordCheck">,
  warn: (message: string) => void,
): void {
  if (!adminAuth.breachedPasswordCheck) warn(BREACH_CHECK_DISABLED_WARNING);
}

/**
 * Without an explicit `rateLimit.enabled`, whether SEC-1's throttle runs is decided by
 * `NODE_ENV`: `dist/context/create-context.mjs:172` <!-- expect: options.rateLimit?.enabled ?? isProduction --> resolves it as
 * `options.rateLimit?.enabled ?? isProduction`, and `isProduction` is a module-scope
 * `const` in `@better-auth/core/dist/env/env-impl.mjs:32` <!-- expect: isProduction = nodeENV === "production" --> (`nodeENV === "production"`,
 * over a `nodeENV` captured at `:30` on that module's first import).
 *
 * Every field is read back off `await auth.$context`, the object the limiter itself
 * consults, never echoed from the options this file passes in:
 * `dist/api/rate-limiter/index.mjs:293` <!-- expect: if (!ctx.rateLimit.enabled) return --> gates on
 * `ctx.rateLimit.enabled`, and
 * `getIP` (`@better-auth/core/dist/utils/ip.mjs:206`) <!-- expect: ipAddressHeaders || DEFAULT_IP_HEADERS --> reads the header list off
 * `ctx.options.advanced.ipAddress`.
 *
 * The numbers are not reported because they are module-private to the vendor and would be
 * an inference printed as an observation: three attempts per ten
 * seconds (`getDefaultSpecialRules`, `dist/api/rate-limiter/index.mjs:305-311`, <!-- expect: window: 10, max: 3 --> matching
 * `/sign-in`, `/sign-up`, `/change-password` and `/change-email`), and the same shape for
 * `/two-factor/*` (`dist/plugins/two-factor/index.mjs:338-344`). <!-- expect: path.startsWith("/two-factor/") -->
 */
export interface SignInThrottleState {
  readonly enabled: boolean;
  /** Header names, never a value: an address identifies a person (SEC-8, SEC-13). */
  readonly addressHeaders: readonly string[];
}

export const SIGN_IN_THROTTLE_ACTIVE_MESSAGE = "sign-in throttling active";

export const SIGN_IN_THROTTLE_INACTIVE_WARNING =
  "sign-in throttling is NOT running in this process: the admin sign-in, change-password " +
  "and two-factor endpoints have no brute-force limiter (SEC-1). This is on by default " +
  "and something switched it off: QCMS_ADMIN_SIGNIN_THROTTLE is set to a false value in " +
  "this environment. It is a development escape hatch, so unset it here unless this " +
  "deployment is meant to serve an unlimited admin sign-in surface. See " +
  "docs/operations.md.";

/**
 * Never acted on here: whether it is set at all is the only thing this process knows about
 * the admin's ingress, and naming it as a constant is what `scripts/env-reference.mjs` sees.
 */
export const ADMIN_TRUSTED_PROXY_HOPS_ENV = "QCMS_ADMIN_TRUSTED_PROXY_HOPS";

/** A declaration, not an observation: this process cannot see the admin's inbound chain. */
export const SIGN_IN_THROTTLE_SHARED_BUCKET_WARNING =
  "sign-in throttling is running, but no proxy is declared in front of the admin in " +
  "this process's environment (QCMS_ADMIN_TRUSTED_PROXY_HOPS is unset or 0 here). " +
  "Where that is the truth - and it is on the default Compose stack, which ships no " +
  "proxy - the admin BFF has no proxy-written X-Forwarded-For entry to resolve and " +
  "vouches for no client address, so every sign-in attempt shares ONE bucket: three " +
  "attempts from any caller hold the admin sign-in and two-factor endpoints closed for " +
  "every administrator until the ten-second window rolls, and a sustained caller holds " +
  "them closed indefinitely (issue #482). This fails safe - the failure is refusal, " +
  "not admission - so it costs availability, not confidentiality. Remedy: put a proxy " +
  "in front of the admin hostname (docs/deploy-ingress.md) and set " +
  "QCMS_ADMIN_TRUSTED_PROXY_HOPS on BOTH the admin and api services; if a proxy is " +
  "already there and only the admin service carries the count, setting it here too is " +
  "what silences this line. This line reports a declaration, not an observation: this " +
  "process cannot see the admin's inbound chain, so setting that variable without a " +
  "real proxy silences the line and keeps the shared bucket. See docs/operations.md.";

/** `0` counts as no proxy: it means trust no forwarded entry, which is the shared bucket. */
export function signInThrottleSharedBucketWarning(
  state: SignInThrottleState,
  env: Record<string, string | undefined>,
): string | undefined {
  if (!state.enabled) return undefined;
  const declared = env[ADMIN_TRUSTED_PROXY_HOPS_ENV]?.trim();
  if (declared !== undefined && declared !== "" && Number(declared) !== 0) return undefined;
  return SIGN_IN_THROTTLE_SHARED_BUCKET_WARNING;
}

/** Awaiting `$context` forces initialisation, so the caller is the composition root. */
export async function readSignInThrottleState(auth: AdminAuth): Promise<SignInThrottleState> {
  const ctx = await auth.$context;
  return {
    enabled: ctx.rateLimit.enabled,
    addressHeaders: ctx.options.advanced.ipAddress.ipAddressHeaders,
  };
}

/**
 * `addressHeaders` is joined into a scalar because the OTel export path takes string,
 * number and boolean fields only.
 */
export async function logSignInThrottleState(
  auth: AdminAuth,
  logger: Pick<Logger, "info" | "warn">,
  env: Record<string, string | undefined> = process.env,
): Promise<SignInThrottleState> {
  const state = await readSignInThrottleState(auth);
  const fields = {
    enabled: state.enabled,
    addressHeaders: state.addressHeaders.join(","),
  };
  if (state.enabled) logger.info(SIGN_IN_THROTTLE_ACTIVE_MESSAGE, fields);
  else logger.warn(SIGN_IN_THROTTLE_INACTIVE_WARNING, fields);

  const sharedBucket = signInThrottleSharedBucketWarning(state, env);
  if (sharedBucket !== undefined) logger.warn(sharedBucket, fields);
  return state;
}

/** The vendor's code, not its message: the message is prose it may reword. */
export const CORPUS_HIT_CODE = "PASSWORD_COMPROMISED";

export const BREACH_LOOKUP_FAILED_CODE = "BREACH_CORPUS_UNREACHABLE";

/**
 * Reaches a response body, so it must name no environment variable: a client cannot act on
 * an operator's knob (ADR-24, enforced by `scripts/check-security-hygiene.mjs`).
 */
export const BREACH_LOOKUP_FAILED_MESSAGE =
  "The SEC-1 breach-corpus lookup to api.pwnedpasswords.com did not complete, so this " +
  "password was refused without ever being compared against the corpus. This is a " +
  "network failure, not an authentication failure and not a judgement about the " +
  "credential: the check fails closed by design. Retry once that host is reachable " +
  "again; a deployment that structurally cannot reach it has a documented configuration " +
  "switch (docs/operations.md).";

/** Operator channels only: a log and a CLI's stderr. Never put this in a response body. */
export const BREACH_LOOKUP_OPERATOR_GUIDANCE =
  "Restore egress to api.pwnedpasswords.com, or set " +
  "QCMS_ADMIN_PASSWORD_BREACH_CHECK=false for a deployment that structurally has none " +
  "(docs/operations.md). That is a documented downgrade against NIST SP 800-63B Rev 4 " +
  "section 3.1.1.2 and OWASP ASVS 5.0 6.2.12 (SEC-1).";

/**
 * `haveIBeenPwned` collapses every lookup failure into an opaque 500, so this relabels by
 * status and code and never by message text; a plain `Error` passes through untouched.
 */
export function explainBreachLookupFailure(
  error: unknown,
  warn?: (message: string) => void,
): unknown {
  if (!isAPIError(error)) return error;
  if (error.status !== "INTERNAL_SERVER_ERROR") return error;
  const code: unknown = (error.body as { code?: unknown } | undefined)?.code;
  if (code === CORPUS_HIT_CODE) return error;
  warn?.(`${BREACH_LOOKUP_FAILED_MESSAGE} ${BREACH_LOOKUP_OPERATOR_GUIDANCE}`);
  return new APIError("SERVICE_UNAVAILABLE", {
    message: BREACH_LOOKUP_FAILED_MESSAGE,
    code: BREACH_LOOKUP_FAILED_CODE,
  });
}

/**
 * Raised from the plugin's default of 100, which would start refusing grants in an
 * installation this design is meant for, while still bounding a runaway sync path.
 */
export const MEMBERSHIP_LIMIT = 5_000;

type PluginInitContext = Parameters<NonNullable<BetterAuthPlugin["init"]>>[0];

/**
 * Order is the mechanism: better-auth runs plugin `init` hooks in array order, so the
 * `hash` this captures is the vendor's checked hash only while this sits after
 * `haveIBeenPwned` in `plugins`. Listed before it, it would wrap the bare hash.
 */
function breachLookupDiagnostics(warn?: (message: string) => void): BetterAuthPlugin {
  return {
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
                throw explainBreachLookupFailure(error, warn);
              }
            },
          },
        },
      };
    },
  };
}

export interface AdminAuthInput {
  readonly db: Executor;
  readonly adminAuth: Config["adminAuth"];
  /** Absent means silence, not a default sink: most callers never send a password through. */
  readonly warn?: (message: string) => void;
}

export type AdminAuth = ReturnType<typeof createAdminAuth>;

export function createAdminAuth(input: AdminAuthInput) {
  const { adminAuth } = input;
  return betterAuth({
    database: drizzleAdapter(input.db, {
      provider: "pg",
      // The adapter's own default is `false`
      // (`@better-auth/drizzle-adapter/dist/index.mjs:563`)
      // <!-- expect: transaction: config.transaction ?? false -->, and the adapter factory
      // defaults the same flag the same way
      // (`@better-auth/core/dist/db/adapter/factory.mjs:31`)
      // <!-- expect: transaction: cfg.transaction ?? false --> before resolving
      // `adapter.transaction` to `createAsIsTransaction`
      // (`@better-auth/core/dist/db/adapter/factory.mjs:422`)
      // <!-- expect: lazyLoadTransaction = createAsIsTransaction(adapter) -->, which hands
      // the callback the very adapter it already had
      // (`@better-auth/core/dist/db/adapter/factory.mjs:18`)
      // <!-- expect: (adapter) => (fn) => fn(adapter) -->, so at the default a
      // `runWithTransaction` wrap rolls nothing back.
      //
      // `/change-password` wraps the session revocation, the credential write and the
      // replacement session in one such wrap
      // (`dist/api/routes/update-user.mjs:173`)
      // <!-- expect: const newSession = await runWithTransaction( -->, and SEC-1 asks that
      // to be one act, so it has to commit as one.
      //
      // `true` also defers the hooks queued inside the wrap until after the commit
      // (`@better-auth/core/dist/context/transaction.mjs:65-110`)
      // <!-- expect: result = await adapter.transaction( -->, the drain-on-failure branch
      // being guarded on the adapter advertising no transaction
      // (`@better-auth/core/dist/context/transaction.mjs:106`)
      // <!-- expect: if (adapter.options?.adapterConfig.transaction === false) -->, which
      // is what makes the `account.update.after` hook below fail closed.
      transaction: true,
      // `@roonga/qcms-db` exports prefixed names and better-auth addresses its models
      // unprefixed, so without this map the adapter finds no tables at all.
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        twoFactor: authTwoFactor,
        organization: authOrganization,
        member: authMember,
        invitation: authInvitation,
        // Declared by the plugin only while `teams.enabled` is on below, and their columns
        // are `NOT NULL` with no default, so they map only alongside the required fields.
        team: authTeam,
        teamMember: authTeamMember,
      },
    }),
    // `secret` stays beside the versioned key set as the legacy fallback, used only for
    // ciphertext predating the `$ba$<version>$` envelope.
    secrets: adminAuth.secrets.map((entry) => ({ ...entry })),
    secret: adminAuth.secret,
    // The admin app's origin, not this API's: the browser only ever sees the admin, so
    // that is the origin the cookies belong to.
    baseURL: adminAuth.baseUrl,
    basePath: AUTH_BASE_PATH,
    // Stated rather than inherited from `baseURL`, because better-auth's CSRF check reads
    // this list and a change to how the origin is derived must not widen it silently.
    trustedOrigins: [adminAuth.baseUrl],
    // Stated so an upstream default flip cannot turn telemetry on.
    telemetry: { enabled: false },
    // Passing a value takes away the `?? isProduction` branch, so `NODE_ENV` no longer
    // decides whether SEC-1's throttle runs.
    rateLimit: { enabled: adminAuth.signInThrottle },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // No reset mail exists, so do not advertise one.
      requireEmailVerification: false,
    },
    session: {
      expiresIn: Math.floor(adminAuth.idleMs / 1000),
      updateAge: Math.floor(adminAuth.idleMs / 4000),
    },
    user: {
      additionalFields: {
        // `input: false` is the load-bearing part: the SEC-3 claim cannot be self-assigned.
        role: { type: "string", required: false, defaultValue: "admin", input: false },
        // A DECLARED field rather than a column the library has never heard of, because
        // the gate reads this off the session user and `parseUserOutput` filters the row
        // against `getFields(options, "user", "output")`
        // (`dist/db/schema.mjs:25`) <!-- expect: filterOutputFields(user, getFields(options, "user", "output")) -->,
        // which merges `options.user.additionalFields`
        // (`dist/db/schema.mjs:12`) <!-- expect: options[modelName]?.additionalFields -->.
        //
        // `defaultValue: true` is what SETS the flag, applied by the library on a create
        // that does not name it
        // (`dist/db/schema.mjs:95`) <!-- expect: action === "create" -->, so every
        // account-creation path inherits the marking rather than opting into it.
        //
        // `input: false` means no update writes it: a truthy value throws
        // (`dist/db/schema.mjs:74`) <!-- expect: is not allowed to be set -->
        // and a falsy one is dropped, so a session holder cannot clear their own flag.
        mustChangePassword: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
      },
    },
    databaseHooks: {
      account: {
        update: {
          /**
           * Clearing the provisional-credential flag is entirely ours: the library offers
           * no forced-password-change option and nothing in `databaseHooks` can refuse a
           * request on a user-field predicate (SEC-1).
           *
           * The event that means "a password was successfully changed" is the write
           * of the new hash to the credential account row, which is
           * `dist/api/routes/update-user.mjs:175`
           * <!-- expect: internalAdapter.updateAccount(account.id, { password: passwordHash }) -->.
           * It is reached only after the `password.verify` of the current password at
           * `dist/api/routes/update-user.mjs:169`
           * <!-- expect: password.verify --> succeeded. `updateAccount` routes through
           * `updateWithHooks`, at `dist/db/internal-adapter.mjs:711`
           * <!-- expect: updateWithHooks -->, which runs this hook.
           *
           * `updateAccount` is also how refreshed OAuth tokens are stored, so the
           * `providerId` guard keeps a token refresh from clearing the flag.
           *
           * `update.after` hooks are queued through `queueAfterTransactionHook`,
           * which runs the hook inline when no transaction is open and defers it
           * otherwise:
           * `@better-auth/core/dist/context/transaction.mjs:139`
           * <!-- expect: if (!store?.isTransactionActive) return executeHook(); -->,
           * and `runWithTransaction` drains that list
           * (`@better-auth/core/dist/context/transaction.mjs:90,109`)
           * <!-- expect: for (const hook of pendingHooks) -->.
           * `/change-password` takes the deferred branch
           * (`dist/api/routes/update-user.mjs:173`)
           * <!-- expect: const newSession = await runWithTransaction( -->, and with
           * `transaction: true` above the drain-on-failure branch is guarded on the
           * adapter advertising no transaction
           * (`@better-auth/core/dist/context/transaction.mjs:106`)
           * <!-- expect: if (adapter.options?.adapterConfig.transaction === false) -->,
           * so a change that does not commit leaves the flag set.
           *
           * The write goes through this process's own executor rather than the library's
           * adapter, so it takes a fresh connection and cannot block on rows the
           * transaction held.
           */
          after: async (account) => {
            const row = account as { readonly providerId?: unknown; readonly userId?: unknown };
            if (row.providerId !== CREDENTIAL_PROVIDER_ID) return;
            if (typeof row.userId !== "string") return;
            await clearMustChangePassword(input.db, row.userId);
          },
        },
      },
    },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // The throttle keys on the BFF's vouched address only. better-auth's default
      // `x-forwarded-for` is browser-controlled at this process (ADR-20), so a caller
      // rotating it would buy a fresh backoff bucket every attempt. With no vouched
      // address every caller shares one bucket, which is the closed failure.
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
      // A config value rather than a `NODE_ENV` read: this process cannot see the
      // browser-facing origin's scheme.
      useSecureCookies: adminAuth.secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        // The primary CSRF control (SEC-9).
        sameSite: "lax",
        path: "/",
      },
    },
    plugins: [
      twoFactor({
        issuer: "QCMS",
        // Restated because flipping it would silently weaken SEC-1.
        skipVerificationOnEnable: false,
        backupCodeOptions: {
          // Restates the vendor's own default rather than changing it:
          // `dist/plugins/two-factor/index.mjs:25-27` <!-- expect: storeBackupCodes: "encrypted" --> builds `backupCodeOptions` as
          // `{ storeBackupCodes: "encrypted", ...options?.backupCodeOptions }`. Stated so
          // an upstream default flip cannot weaken SEC-7 silently.
          storeBackupCodes: "encrypted",
        },
      }),
      // SEC-1's breach-corpus check: a k-anonymity lookup that sends only the first five
      // hex characters of the password's SHA-1, so the password never leaves the process
      // and the endpoint learns nothing usable (SEC-8). Hooks `ctx.password.hash`, so it
      // covers every path that sets a password. Fail-closed is the vendor's and is kept:
      // an unreachable corpus refuses the password, and a structurally offline deployment
      // turns the check off in configuration rather than at runtime.
      haveIBeenPwned({ enabled: adminAuth.breachedPasswordCheck }),
      // Must stay immediately after `haveIBeenPwned`: it wraps whatever `password.hash` is
      // at its turn.
      breachLookupDiagnostics(input.warn),
      // Declared for its models and its policy only. Enforcement is the QCMS membership
      // middleware, which calls the plugin's authorize function directly because the
      // plugin's HTTP `hasPermission` needs a signed cookie this API does not hold.
      organization({
        // A dot is a plain string in the plugin's comma-separated role list, so the
        // creator-role and last-owner protections work on the name ADR-41 uses.
        creatorRole: "forms.owner",
        // One declaration, read by the library here and by the membership resolver.
        ac: accessControl,
        roles,
        // Off: owner-defined roles cannot be enumerated in ADR-41's permissions matrix.
        dynamicAccessControl: { enabled: false },
        membershipLimit: MEMBERSHIP_LIMIT,
        teams: {
          enabled: true,
          // A team is a grant, so a default team would be a grant nobody wrote.
          defaultTeam: { enabled: false },
          // The plugin's default refuses removing an organisation's last team, which
          // would make the last grant unrevokable.
          allowRemovingAllTeams: true,
        },
        organizationHooks: pluginWriteBackstop(input.db),
        // A workspace is an operator act, not something an administrator makes by signing
        // in (ADR-41). The server-side `createOrganization` with an explicit `userId` is a
        // system action and is unaffected (`dist/plugins/organization/routes/crud-org.mjs:57`),
        // <!-- expect: const isSystemAction = !session && ctx.body.userId -->
        // which is what lets the bootstrap seed one.
        allowUserToCreateOrganization: false,
        // A workspace is archived, never deleted (Q15).
        disableOrganizationDeletion: true,
        schema: {
          organization: {
            // Typed fields, never `organization.metadata` (Q39): that column is replaced
            // wholesale by any holder of `organization: update`, so a decision resting on
            // it is one anybody with that statement rewrites. All `input: false`, so no
            // request body sets them.
            additionalFields: {
              isShared: { type: "boolean", required: false, defaultValue: false, input: false },
              requireSecondApprover: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: false,
              },
              archivedAt: { type: "date", required: false, input: false },
              // Defaults off: a grant on `test` responses is a grant on personal data,
              // since a test run can involve real respondents (Q57).
              seedNewEditorsWithTestData: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: false,
              },
            },
          },
          team: {
            // These three fields ARE the grant, so they are required with no default; the
            // matching columns are `NOT NULL` with no default, and the library's startup
            // schema check makes a `NOT NULL` column it never writes fatal.
            additionalFields: {
              role: { type: "string", required: true },
              environments: { type: "string[]", required: true },
              forms: { type: "string[]", required: true },
              // Written only by the directory sync path; declared now so the column
              // predates it rather than arriving as a migration against a live deployment.
              externalGroupId: { type: "string", required: false, input: false },
            },
          },
        },
      }),
    ],
  });
}
