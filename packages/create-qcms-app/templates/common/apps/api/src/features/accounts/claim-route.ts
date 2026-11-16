import { z } from "@hono/zod-openapi";
import {
  boundAccountTransaction,
  consumeSignInLink,
  findAccountById,
  findSignInLinkByHash,
  holdsAccountPassword,
  signInLinkIsLive,
  tryLockAccount,
  wasSentResetOrReactivationLink,
} from "@roonga/qcms-db";
import { isAPIError } from "better-auth/api";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { adminAuthFor, adminAuthOn } from "../auth/route.js";
import {
  asClaimSignIn,
  BREACH_LOOKUP_FAILED_CODE,
  MIN_PASSWORD_LENGTH,
} from "../auth/instance.js";
import { PasswordRefused, setAccountPassword, verifyAccountPassword } from "./credential.js";
import { CLAIM_PATH, signInTokenHash } from "./tokens.js";

// The claim is mounted beside the better-auth endpoints because it issues a session, so it
// cannot sit behind the admin-session gate. It needs no rate limit of its own: the token is
// 256 random bits, and an unknown one is refused by one indexed read before any hashing.

/**
 * What each link purpose does with the password sent: a creation or reactivation link sets
 * it, and so does a reset link once the reset took the password away. A reset that kept the
 * password, a factor-only reset, signs the person in with it instead and sets nothing. A
 * creation link for an account that was ever reset or reactivated sets nothing either.
 */
type PasswordUse = "set" | "verify";

export function passwordUseFor(
  purpose: string,
  account: { readonly holdsPassword: boolean; readonly wasReset: boolean },
): PasswordUse | undefined {
  if (purpose === "account-created") return account.wasReset ? undefined : "set";
  if (purpose === "reactivated") return "set";
  if (purpose === "reset") return account.holdsPassword ? "verify" : "set";
  return undefined;
}

function passwordIncorrect(): ApiError {
  return new ApiError(
    "CLAIM_PASSWORD_INCORRECT",
    400,
    "Only your second factor was reset, so sign in with the password you already have. " +
      "That password was not it, and the link is now used; ask a Site administrator to send " +
      "a new one.",
  );
}

const ClaimBody = z.strictObject({
  token: z.string().min(1).max(512),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(1024),
});

/**
 * One answer for an unknown, used, expired or superseded token, and for an account that
 * cannot be claimed: a caller holding a token learns nothing else about it.
 */
function linkRefused(): ApiError {
  return new ApiError(
    "CLAIM_LINK_REFUSED",
    400,
    "That sign-in link cannot be used. A link works once and expires 72 hours after it " +
      "was sent; ask a Site administrator to send a new one.",
  );
}

function passwordRefused(error: unknown): ApiError {
  if (isAPIError(error)) {
    const body = error.body as { code?: unknown; message?: unknown } | undefined;
    const code = typeof body?.code === "string" ? body.code : "PASSWORD_REFUSED";
    const message = typeof body?.message === "string" ? body.message : "That password was refused";
    // A breach lookup that did not complete is not a judgement about the password, so it
    // keeps its own status; every other refusal about the password answers 400 and carries
    // the vendor's code for the screen to read.
    const status = code === BREACH_LOOKUP_FAILED_CODE ? 503 : 400;
    return new ApiError(code, status, message);
  }
  return new ApiError("PASSWORD_REFUSED", 400, "That password was refused");
}

export const registerAccountClaim: SliceRegistrar = (group, deps: Deps) => {
  group.post(CLAIM_PATH, async (c) => {
    const parsed = ClaimBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_BODY",
        400,
        `A claim needs the link's token and a password of at least ${String(MIN_PASSWORD_LENGTH)} characters`,
      );
    }
    const { token, password } = parsed.data;

    const exec = deps.databases.control;
    const now = deps.clock.now();
    const tokenHash = await signInTokenHash(token);

    const link = await findSignInLinkByHash(exec, tokenHash);
    if (link === undefined || !signInLinkIsLive(link, now)) throw linkRefused();

    const auth = adminAuthFor(deps);
    // A session for somebody else is the wrong-account use: the link belongs to one
    // account, so it never signs a different one in and never claims one on its behalf.
    const resolved = await auth.api.getSession({ headers: c.req.raw.headers });
    if (resolved !== null && resolved.user.id !== link.userId) throw linkRefused();

    // The password is written on this transaction's connection under a tried lock, so a
    // refusal rolls everything back and no request waits for a second pooled connection
    // or queues behind a claim in flight while holding one.
    // A wrong current password spends the link and commits, so the token is not a way to
    // guess the kept password.
    const claimed = await exec.transaction(async (tx) => {
      await boundAccountTransaction(tx);
      if (!(await tryLockAccount(tx, link.userId))) throw linkRefused();
      if ((await consumeSignInLink(tx, tokenHash, now)) === undefined) throw linkRefused();
      const found = await findAccountById(tx, link.userId);
      if (found === undefined || found.disabledAt !== null) throw linkRefused();
      // A claimed account already holds a password, so a link that outlived the claim is
      // not a way to set another one. A reset and a reactivation unclaim the account.
      if (found.claimedAt !== null) throw linkRefused();

      const use = passwordUseFor(link.purpose, {
        holdsPassword: await holdsAccountPassword(tx, found.userId),
        wasReset: await wasSentResetOrReactivationLink(tx, found.userId),
      });
      if (use === undefined) throw linkRefused();
      const txAuth = adminAuthOn(deps, tx);
      if (use === "verify") {
        if (!(await verifyAccountPassword(txAuth, found.userId, password))) return undefined;
        return found;
      }
      // The write revokes every session the account holds (`revokeSessionsOnPasswordReset`),
      // so one minted from an earlier link does not outlive it.
      try {
        await setAccountPassword(txAuth, found.userId, password);
      } catch (error) {
        if (error instanceof PasswordRefused) throw passwordRefused(error.cause);
        throw error;
      }
      return found;
    });
    if (claimed === undefined) throw passwordIncorrect();
    const account = claimed;

    // The session issued here is the one that enrols the second factor. The claim itself
    // is written only once that factor is verified, so the account still holds nothing.
    const signedIn = await asClaimSignIn(() =>
      auth.api.signInEmail({
        body: { email: account.email, password },
        asResponse: true,
      }),
    );
    if (!signedIn.ok) {
      throw new ApiError("CLAIM_FAILED", 500, "The claim could not be completed");
    }
    const body = (await signedIn.json()) as { twoFactorRedirect?: boolean };

    const response = c.json({ twoFactorRedirect: body.twoFactorRedirect === true }, 200);
    for (const cookie of signedIn.headers.getSetCookie()) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  });
};
