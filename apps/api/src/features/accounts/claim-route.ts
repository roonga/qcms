import { z } from "@hono/zod-openapi";
import {
  consumeSignInLink,
  findAccountById,
  findSignInLinkByHash,
  signInLinkIsLive,
} from "@roonga/qcms-db";
import { isAPIError } from "better-auth/api";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { adminAuthFor } from "../auth/route.js";
import { MIN_PASSWORD_LENGTH } from "../auth/instance.js";
import { claimAfterFactorVerified } from "./claim.js";
import { hashChosenPassword, PasswordRefused, writeAccountPasswordHash } from "./credential.js";
import { CLAIM_PATH, signInTokenHash } from "./tokens.js";

// The claim is mounted beside the better-auth endpoints because it issues a session, so it
// cannot sit behind the admin-session gate. It needs no rate limit of its own: the token is
// 256 random bits, and an unknown one is refused by one indexed read before any hashing.

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
    // The vendor's own status is not in this API's set, so every refusal about the
    // password answers 400 and carries the vendor's code for the screen to read.
    return new ApiError(code, 400, message);
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

    const account = await findAccountById(exec, link.userId);
    if (account === undefined || account.disabledAt !== null) throw linkRefused();

    const auth = adminAuthFor(deps);
    // A session for somebody else is the wrong-account use: the link belongs to one
    // account, so it never signs a different one in and never claims one on its behalf.
    const resolved = await auth.api.getSession({ headers: c.req.raw.headers });
    if (resolved !== null && resolved.user.id !== account.userId) throw linkRefused();

    let passwordHash: string;
    try {
      passwordHash = await hashChosenPassword(auth, password);
    } catch (error) {
      if (error instanceof PasswordRefused) throw passwordRefused(error.cause);
      throw error;
    }

    // Consumed only once the password is in hand, so a refused password never burns the
    // one link the person was sent. The compare-and-set is the single-use guarantee.
    if ((await consumeSignInLink(exec, tokenHash, now)) === undefined) throw linkRefused();
    await writeAccountPasswordHash(auth, account.userId, passwordHash);
    // Where the deployment does not require a second factor, which is a development
    // escape hatch only, the password is the whole claim; otherwise the factor
    // verification writes it, and the account holds nothing until then.
    if (deps.flags.adminTwoFactor !== "required") {
      await claimAfterFactorVerified(deps, account.userId);
    }

    const signedIn = await auth.api.signInEmail({
      body: { email: account.email, password },
      asResponse: true,
    });
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
