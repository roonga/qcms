import {
  boundAccountTransaction,
  issueSignInLink,
  lockAccount,
  recordSignInLinkDelivery,
  tryLockAccount,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { adminLink, SIGN_IN_LINK_TTL_HOURS, type SignInLinkPurpose } from "../email/templates.js";
import { signInLinkMessage } from "../email/templates.js";
import { claimPathFor, mintSignInToken, signInTokenHash } from "./tokens.js";

const HOUR_MS = 60 * 60 * 1000;

/** What a caller learns about one send. `pending` never escapes: a send always answers. */
export type SignInLinkDeliveryOutcome = "sent" | "undeliverable";

/**
 * Mint, store the digest of and email one link. `withinIssue`, and `purpose` given as a
 * function, run in the issuing transaction under the account's lock, before the mail. With
 * `busy`, the lock is tried, and `busy()` thrown while it is held.
 */
export async function issueAndSendSignInLink(
  deps: Deps,
  exec: Executor,
  input: {
    readonly userId: string;
    readonly email: string;
    readonly purpose: SignInLinkPurpose | ((tx: Executor) => Promise<SignInLinkPurpose>);
    readonly issuedBy: string | ((tx: Executor) => Promise<string>);
  },
  withinIssue?: (tx: Executor) => Promise<void>,
  busy?: () => Error,
): Promise<SignInLinkDeliveryOutcome> {
  if (!deps.config.mail.configured) throw new Error("outbound mail is not configured");
  const now = deps.clock.now();
  const token = mintSignInToken();
  const tokenHash = await signInTokenHash(token);
  const { issued: link, purpose } = await exec.transaction(async (tx) => {
    await boundAccountTransaction(tx);
    if (busy === undefined) await lockAccount(tx, input.userId);
    else if (!(await tryLockAccount(tx, input.userId))) throw busy();
    await withinIssue?.(tx);
    const purpose = typeof input.purpose === "function" ? await input.purpose(tx) : input.purpose;
    const issuedBy =
      typeof input.issuedBy === "function" ? await input.issuedBy(tx) : input.issuedBy;
    const issued = await issueSignInLink(tx, {
      userId: input.userId,
      tokenHash,
      purpose,
      expiresAt: new Date(now.getTime() + SIGN_IN_LINK_TTL_HOURS * HOUR_MS),
      issuedBy,
      now,
    });
    return { issued, purpose };
  });

  const result = await deps.mailer.send(
    signInLinkMessage(
      input.email,
      purpose,
      adminLink(deps.config.mail.linkBaseUrl, claimPathFor(token)),
    ),
  );
  const delivery: SignInLinkDeliveryOutcome = result.ok ? "sent" : "undeliverable";
  await recordSignInLinkDelivery(exec, link.id, delivery);
  return delivery;
}
