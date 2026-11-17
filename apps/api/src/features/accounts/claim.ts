import {
  boundAccountTransaction,
  findAccountById,
  findAdminById,
  invalidateLiveSignInLinks,
  lockAccount,
  markAccountClaimed,
  revokeAccountSessions,
  settleSuspensionRun,
  signInLinkHold,
  writeSiteAuditRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";

/**
 * Write the claim once the second factor is verified; a later verification writes nothing,
 * and neither does one for an account with no enrolled factor or an unspent link.
 * In the same transaction every live link dies and every session but `keepToken`'s is
 * deleted, because the admin gate reads the factor from the account, not the session.
 */
export async function claimAfterFactorVerified(
  deps: Deps,
  userId: string,
  keepToken: string | undefined,
): Promise<void> {
  const now = deps.clock.now();
  await deps.databases.control.transaction(async (tx) => {
    await boundAccountTransaction(tx);
    await lockAccount(tx, userId);
    const account = await findAccountById(tx, userId);
    if (account === undefined || account.claimedAt !== null || account.disabledAt !== null) return;
    if ((await findAdminById(tx, userId))?.twoFactorEnabled !== true) return;
    if ((await signInLinkHold(tx, userId)) === "link") return;
    await invalidateLiveSignInLinks(tx, userId, now);
    await revokeAccountSessions(tx, userId, keepToken);
    await markAccountClaimed(tx, userId, now);
    await settleSuspensionRun(tx, { userId, by: userId, at: now });
    await writeSiteAuditRow(tx, {
      actor: userId,
      subject: userId,
      kind: "account",
      detail: "act=claim",
      occurredAt: now,
    });
  });
}
