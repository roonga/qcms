import type { AdminAuth } from "../auth/instance.js";

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

/** Raised where the password itself is refused, so the caller leaves the link unconsumed. */
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

/**
 * Set the account's password through the vendor's own reset endpoint rather than through
 * the adapter, because the SEC-1 breach lookup is a plugin that wraps `password.hash` and
 * reads whichever endpoint better-auth is running:
 * `dist/plugins/haveibeenpwned/index.mjs:69` <!-- expect: const c = getCurrentAuthEndpointContext(); -->
 * `@better-auth/core/dist/context/endpoint-context.mjs:35` <!-- expect: No auth context found. -->
 * A hash called outside an endpoint therefore throws instead of checking anything.
 * `/reset-password` is one of the paths the plugin checks, and `auth.api.*` dispatches
 * through the same endpoint context the HTTP router uses:
 * `dist/plugins/haveibeenpwned/index.mjs:54` <!-- expect: "/reset-password", -->
 * `dist/api/dispatch.mjs:210` <!-- expect: runWithEndpointContext(internalContext, -->
 * The endpoint also creates the credential row where there is none and spends the reset
 * token in the same transaction as the password write:
 * `dist/utils/password.mjs:32` <!-- expect: runWithTransaction(ctx.context.adapter, -->
 * so a refused password leaves nothing behind and the caller's own link is still unspent.
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
    throw new PasswordRefused(error);
  }
}
