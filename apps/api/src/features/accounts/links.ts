import { issueSignInLink, recordSignInLinkDelivery } from "@roonga/qcms-db";
import type { Executor, SignInLinkDelivery } from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { adminLink, SIGN_IN_LINK_TTL_HOURS, type SignInLinkPurpose } from "../email/templates.js";
import { signInLinkMessage } from "../email/templates.js";
import { claimPathFor, mintSignInToken, signInTokenHash } from "./tokens.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Mint one link, store its digest and email it. The token exists only in this function's
 * frame and in the message: it is never returned, logged or written to a row, so no screen
 * and no audit can show it to the administrator who asked for it.
 */
export async function issueAndSendSignInLink(
  deps: Deps,
  exec: Executor,
  input: {
    readonly userId: string;
    readonly email: string;
    readonly purpose: SignInLinkPurpose;
    readonly issuedBy: string;
  },
): Promise<SignInLinkDelivery> {
  if (!deps.config.mail.configured) throw new Error("outbound mail is not configured");
  const now = deps.clock.now();
  const token = mintSignInToken();
  const link = await exec.transaction((tx) =>
    issueSignInLink(tx, {
      userId: input.userId,
      tokenHash: signInTokenHash(token),
      purpose: input.purpose,
      expiresAt: new Date(now.getTime() + SIGN_IN_LINK_TTL_HOURS * HOUR_MS),
      issuedBy: input.issuedBy,
      now,
    }),
  );

  const result = await deps.mailer.send(
    signInLinkMessage(
      input.email,
      input.purpose,
      adminLink(deps.config.mail.linkBaseUrl, claimPathFor(token)),
    ),
  );
  const delivery: SignInLinkDelivery = result.ok ? "sent" : "undeliverable";
  await recordSignInLinkDelivery(exec, link.id, delivery);
  return delivery;
}
