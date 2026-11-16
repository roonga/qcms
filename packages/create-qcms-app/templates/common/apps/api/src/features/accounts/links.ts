import { issueSignInLink, lockAccount, recordSignInLinkDelivery } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { adminLink, SIGN_IN_LINK_TTL_HOURS, type SignInLinkPurpose } from "../email/templates.js";
import { signInLinkMessage } from "../email/templates.js";
import { claimPathFor, mintSignInToken, signInTokenHash } from "./tokens.js";

const HOUR_MS = 60 * 60 * 1000;

/** What a caller learns about one send. `pending` never escapes: a send always answers. */
export type SignInLinkDeliveryOutcome = "sent" | "undeliverable";

/**
 * Mint one link, store its digest and email it; the token is never returned, logged or
 * stored. `withinIssue` runs in the issuing transaction under the account's lock, before
 * the mail, so a check it makes holds for the issue and a row it writes commits with it.
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
  withinIssue?: (tx: Executor) => Promise<void>,
): Promise<SignInLinkDeliveryOutcome> {
  if (!deps.config.mail.configured) throw new Error("outbound mail is not configured");
  const now = deps.clock.now();
  const token = mintSignInToken();
  const tokenHash = await signInTokenHash(token);
  const link = await exec.transaction(async (tx) => {
    await lockAccount(tx, input.userId);
    await withinIssue?.(tx);
    return issueSignInLink(tx, {
      userId: input.userId,
      tokenHash,
      purpose: input.purpose,
      expiresAt: new Date(now.getTime() + SIGN_IN_LINK_TTL_HOURS * HOUR_MS),
      issuedBy: input.issuedBy,
      now,
    });
  });

  const result = await deps.mailer.send(
    signInLinkMessage(
      input.email,
      input.purpose,
      adminLink(deps.config.mail.linkBaseUrl, claimPathFor(token)),
    ),
  );
  const delivery: SignInLinkDeliveryOutcome = result.ok ? "sent" : "undeliverable";
  await recordSignInLinkDelivery(exec, link.id, delivery);
  return delivery;
}
