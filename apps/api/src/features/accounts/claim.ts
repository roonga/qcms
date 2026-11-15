import {
  findAccountById,
  invalidateLiveSignInLinks,
  markAccountClaimed,
  writeSiteAuditRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";

/**
 * Write the claim once the second factor is verified, which is the act the spec's
 * criterion 53 names: a password alone leaves the account unclaimed, so it still holds
 * nothing. Called from the auth mount after the library has answered, and guarded on
 * `claimedAt` so a later verification by an already-claimed account writes no row.
 *
 * Every link the account still holds dies with the claim, in the same transaction: one
 * issued between the password and the factor would otherwise stay usable for its 72 hours
 * and set a new password on an account that is now live.
 */
export async function claimAfterFactorVerified(deps: Deps, userId: string): Promise<void> {
  const exec = deps.databases.control;
  const account = await findAccountById(exec, userId);
  if (account === undefined || account.claimedAt !== null || account.disabledAt !== null) return;
  const now = deps.clock.now();
  await exec.transaction(async (tx) => {
    await markAccountClaimed(tx, userId, now);
    await invalidateLiveSignInLinks(tx, userId, now);
    await writeSiteAuditRow(tx, {
      actor: userId,
      subject: userId,
      kind: "account",
      detail: "act=claim",
      occurredAt: now,
    });
  });
}
