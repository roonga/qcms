import {
  findAccountById,
  invalidateLiveSignInLinks,
  markAccountClaimed,
  writeSiteAuditRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";

/**
 * Write the claim once the second factor is verified, which is the act criterion 53 names:
 * a password alone leaves the account unclaimed. Guarded on `claimedAt`, so a later
 * verification writes no row. Every link the account still holds dies in the same
 * transaction, the one a resend crossing the claim left live included.
 */
export async function claimAfterFactorVerified(deps: Deps, userId: string): Promise<void> {
  const exec = deps.databases.control;
  const account = await findAccountById(exec, userId);
  if (account === undefined || account.claimedAt !== null || account.disabledAt !== null) return;
  const now = deps.clock.now();
  await exec.transaction(async (tx) => {
    await invalidateLiveSignInLinks(tx, userId, now);
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
