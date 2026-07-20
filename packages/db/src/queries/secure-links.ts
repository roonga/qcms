import { and, desc, eq, isNull } from "drizzle-orm";

import type { FormId, LinkId } from "@qcms/core";

import { secureLinks } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * Server-side state for one secure link. Hand-authored (issue #5) because its
 * branded-id columns (`link_id`, `form_id`) resolve to a TypeScript `error` type
 * through this package's emitted `.d.ts` when consumed via `$inferSelect` - the
 * same declaration-emit degradation the enum columns hit - so consumers reading
 * `linkId` would see unsafe member access. Keep every field in lockstep with the
 * `secure_links` table in `schema/secure-links.ts`; the drift guard below fails
 * the build if they diverge.
 */
export interface SecureLinkRow {
  linkId: LinkId;
  formId: FormId;
  expiresAt: Date;
  oneTime: boolean;
  consumedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

// Drift guard (issue #5): assert SecureLinkRow is structurally identical to what
// Drizzle infers from the `secure_links` table. `$inferSelect` resolves soundly
// here in the package source; it only degrades through the emitted `.d.ts`.
export type _SecureLinkRowMatchesTable = AssignableTo<
  SecureLinkRow,
  typeof secureLinks.$inferSelect
> &
  AssignableTo<typeof secureLinks.$inferSelect, SecureLinkRow>;

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
 * List every secure link minted for a form, newest first (task 024). Returns
 * the raw rows - the admin slice derives display state
 * (active/consumed/expired/revoked) from `consumedAt`/`revokedAt`/`expiresAt`
 * against the request clock; storage stays shape-preserving (R5).
 */
export async function listSecureLinks(exec: Executor, formId: FormId): Promise<SecureLinkRow[]> {
  return exec
    .select()
    .from(secureLinks)
    .where(eq(secureLinks.formId, formId))
    .orderBy(desc(secureLinks.createdAt));
}

/**
 * Atomically consume a one-time secure link. The compare-and-set on
 * `consumed_at` (set only where it is still `NULL` and the link is not revoked)
 * means that under two concurrent consumers **exactly one** wins - the row-level
 * lock serializes the two UPDATEs and the second re-checks the `WHERE` after
 * acquiring the lock, matching no row. The winner gets the updated row; every
 * loser (already consumed, or revoked) gets `undefined`. A valid signature is
 * never sufficient on its own (SEC-2) - this is where replay is stopped.
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
