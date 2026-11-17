import { isAPIError } from "better-auth/api";

import { BREACH_LOOKUP_FAILED_CODE, type AdminAuth } from "../auth/instance.js";

// The account rows better-auth owns, reached through its own internal adapter because this
// deployment mounts no sign-up endpoint (ADR-09).

export interface CreatedAccount {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

/**
 * Create an account with no credential and no claim. Until the claim writes a password,
 * `POST /sign-in/email` cannot admit it: there is no credential row to verify against, so
 * the emailed link is the only door.
 */
export async function createUnclaimedAccount(
  auth: AdminAuth,
  input: { readonly email: string; readonly name: string },
): Promise<CreatedAccount> {
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createUser(
    {
      email: input.email,
      name: input.name,
      emailVerified: false,
      // No provisional credential exists to replace, so the forced-change gate does not
      // apply; `claimedAt` is what holds this account until it is claimed.
      mustChangePassword: false,
    },
    // The provisioning origin the library records. The account will hold an email and
    // password credential, written by its claim.
    { method: "email-password" },
  );
  return { userId: created.id, email: created.email, name: created.name };
}

/**
 * Raised where the password is refused or the breach lookup could not judge it, so the
 * caller answers a refusal and rolls the claim back. Any other failure is rethrown as is.
 */
export class PasswordRefused extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("password refused");
    this.name = "PasswordRefused";
    this.cause = cause;
  }
}

/**
 * The library's own single-use reset token. It is minted and spent inside one call here and
 * never emailed: QCMS's own `control.sign_in_links` row is the link a person holds.
 */
const RESET_TOKEN_TTL_MS = 60_000;

const RESET_IDENTIFIER_PREFIX = "reset-password:";

function mintResetToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isPasswordRefusal(error: unknown): boolean {
  if (!isAPIError(error)) return false;
  const code: unknown = (error.body as { code?: unknown } | undefined)?.code;
  return code === BREACH_LOOKUP_FAILED_CODE || error.statusCode < 500;
}

/**
 * Through the vendor's reset endpoint rather than the adapter: the SEC-1 breach lookup
 * wraps `password.hash` and reads the endpoint being run, so a hash called outside one
 * checks nothing. `/reset-password` is a path the plugin checks and `auth.api.*` dispatches
 * in that context; the endpoint writes the credential, creating its row, and spends its token.
 * `dist/plugins/haveibeenpwned/index.mjs:69` <!-- expect: const c = getCurrentAuthEndpointContext(); -->
 * `@better-auth/core/dist/context/endpoint-context.mjs:35` <!-- expect: No auth context found. -->
 * `dist/plugins/haveibeenpwned/index.mjs:54` <!-- expect: "/reset-password", -->
 * `dist/api/dispatch.mjs:210` <!-- expect: runWithEndpointContext(internalContext, -->
 * `dist/utils/password.mjs:32` <!-- expect: runWithTransaction(ctx.context.adapter, -->
 */
export async function setAccountPassword(
  auth: AdminAuth,
  userId: string,
  password: string,
): Promise<void> {
  const ctx = await auth.$context;
  const token = mintResetToken();
  const identifier = `${RESET_IDENTIFIER_PREFIX}${token}`;
  await ctx.internalAdapter.createVerificationValue({
    identifier,
    value: userId,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  try {
    await auth.api.resetPassword({ body: { token, newPassword: password } });
  } catch (error) {
    await ctx.internalAdapter.deleteVerificationByIdentifier(identifier).catch(() => undefined);
    throw isPasswordRefusal(error) ? new PasswordRefused(error) : error;
  }
}

/**
 * Whether `password` is the account's current one, read through the library's own verify
 * so the comparison and the hash format stay the vendor's. Never returns the hash.
 * `dist/utils/password.mjs:49` <!-- expect: findCredentialAccount(data.userId) -->
 */
export async function verifyAccountPassword(
  auth: AdminAuth,
  userId: string,
  password: string,
): Promise<boolean> {
  const ctx = await auth.$context;
  const credential = await ctx.internalAdapter.findCredentialAccount(userId);
  const hash = credential?.password;
  if (typeof hash !== "string" || hash === "") return false;
  return ctx.password.verify({ hash, password });
}
