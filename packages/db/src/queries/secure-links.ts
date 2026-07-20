import { and, eq, isNull } from "drizzle-orm";

import type { FormId, LinkId } from "@qcms/core";

import { secureLinks } from "../schema/index.js";
import type { Executor } from "./executor.js";

export type SecureLinkRow = typeof secureLinks.$inferSelect;

/** Insert server-side state for a secure link (SEC-2). */
export async function insertSecureLink(
  exec: Executor,
  input: { linkId: LinkId; formId: FormId; expiresAt: Date; oneTime?: boolean },
): Promise<SecureLinkRow> {
  const [row] = await exec
    .insert(secureLinks)
    .values({
      linkId: input.linkId,
      formId: input.formId,
      expiresAt: input.expiresAt,
      ...(input.oneTime === undefined ? {} : { oneTime: input.oneTime }),
    })
    .returning();
  return row!;
}

/** Read a secure link's server-side state, or `undefined`. */
export async function getSecureLink(
  exec: Executor,
  linkId: LinkId,
): Promise<SecureLinkRow | undefined> {
  const [row] = await exec
    .select()
    .from(secureLinks)
    .where(eq(secureLinks.linkId, linkId))
    .limit(1);
  return row;
}

/**
 * Atomically consume a one-time secure link. The compare-and-set on
 * `consumed_at` (set only where it is still `NULL` and the link is not revoked)
 * means that under two concurrent consumers **exactly one** wins — the row-level
 * lock serializes the two UPDATEs and the second re-checks the `WHERE` after
 * acquiring the lock, matching no row. The winner gets the updated row; every
 * loser (already consumed, or revoked) gets `undefined`. A valid signature is
 * never sufficient on its own (SEC-2) — this is where replay is stopped.
 *
 * Intended for one-time links; callers gate on `oneTime` before calling.
 */
export async function consumeSecureLink(
  exec: Executor,
  linkId: LinkId,
  now: Date,
): Promise<SecureLinkRow | undefined> {
  const [row] = await exec
    .update(secureLinks)
    .set({ consumedAt: now })
    .where(
      and(
        eq(secureLinks.linkId, linkId),
        isNull(secureLinks.consumedAt),
        isNull(secureLinks.revokedAt),
      ),
    )
    .returning();
  return row;
}

/**
 * Revoke a secure link so it stops working immediately (SEC-2). Idempotent: a
 * second revoke matches no row (already revoked) and returns `undefined`.
 */
export async function revokeSecureLink(
  exec: Executor,
  linkId: LinkId,
  now?: Date,
): Promise<SecureLinkRow | undefined> {
  const [row] = await exec
    .update(secureLinks)
    .set({ revokedAt: now ?? new Date() })
    .where(and(eq(secureLinks.linkId, linkId), isNull(secureLinks.revokedAt)))
    .returning();
  return row;
}
