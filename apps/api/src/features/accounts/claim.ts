import {
  findAccountById,
  invalidateLiveSignInLinks,
  lockAccount,
  markAccountClaimed,
  revokeAccountSessions,
  writeSiteAuditRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";

/**
 * Write the claim once the second factor is verified; a later verification writes nothing.
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
    await lockAccount(tx, userId);
    const account = await findAccountById(tx, userId);
    if (account === undefined || account.claimedAt !== null || account.disabledAt !== null) return;
    await invalidateLiveSignInLinks(tx, userId, now);
    await revokeAccountSessions(tx, userId, keepToken);
    await markAccountClaimed(tx, userId, now);
    await writeSiteAuditRow(tx, {
      actor: userId,
      subject: userId,
      kind: "account",
      detail: "act=claim",
      occurredAt: now,
    });
  });
}
