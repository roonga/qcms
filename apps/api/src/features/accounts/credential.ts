import { CREDENTIAL_PROVIDER_ID, type AdminAuth } from "../auth/instance.js";

/**
 * The account rows better-auth owns, reached through its own internal adapter rather than
 * an HTTP endpoint: there is no sign-up surface on this deployment (ADR-09), and an
 * account created here deliberately holds no credential at all until its claim writes one.
 * `password.hash` is the library's checked hash, so the SEC-1 breach lookup runs on the
 * password the person chooses and on nothing else.
 */

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

/** Hash a chosen password through the library's checked hash, or refuse it. */
export async function hashChosenPassword(auth: AdminAuth, password: string): Promise<string> {
  const ctx = await auth.$context;
  try {
    return await ctx.password.hash(password);
  } catch (error) {
    throw new PasswordRefused(error);
  }
}

/**
 * Write an already-hashed password onto the account's credential row, creating that row
 * the first time. Both shapes exist because a claim writes the first password and a
 * reactivation writes a later one onto the row the claim left behind.
 */
export async function writeAccountPasswordHash(
  auth: AdminAuth,
  userId: string,
  passwordHash: string,
): Promise<void> {
  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findCredentialAccount(userId);
  if (existing === null || existing === undefined) {
    await ctx.internalAdapter.createAccount({
      userId,
      providerId: CREDENTIAL_PROVIDER_ID,
      accountId: userId,
      password: passwordHash,
    });
    return;
  }
  await ctx.internalAdapter.updatePassword(userId, passwordHash);
}
