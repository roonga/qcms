import { and, desc, eq, isNull } from "drizzle-orm";

import type { FormId, LinkId } from "@roonga/qcms-core";

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
  /**
   * The environment this link belongs to (Q46). `NOT NULL`, because the composite
   * `(link_id, environment)` key a session references is skipped entirely under
   * `MATCH SIMPLE` when any referencing column is NULL.
   */
  environment: string;
}

// Drift guard (issue #5): assert SecureLinkRow is structurally identical to what
// Drizzle infers from the `secure_links` table. `$inferSelect` resolves soundly
// here in the package source; it only degrades through the emitted `.d.ts`.
export type _SecureLinkRowMatchesTable = AssignableTo<
  SecureLinkRow,
  typeof secureLinks.$inferSelect
> &
  AssignableTo<typeof secureLinks.$inferSelect, SecureLinkRow>;

/**
 * Insert server-side state for a secure link (SEC-2).
 *
 * **`environment` is required, and since task 066 it is the caller's own** (Q19, Q46).
 * Task 064 created the column and the `(link_id, environment)` unique key the thirteenth
 * guard references; task 066 takes the value from the mint request, where the field is
 * required on the API and a caller that omits it is refused, and refuses a token later
 * presented under the wrong prefix.
 *
 * There is no default here on purpose. A helper that quietly defaulted to `prod` would
 * be exactly the failure Q19 refuses: a script that omits the field and silently gets a
 * production link.
 */
export async function insertSecureLink(
  exec: Executor,
  input: {
    linkId: LinkId;
    formId: FormId;
    expiresAt: Date;
    environment: string;
    oneTime?: boolean;
  },
): Promise<SecureLinkRow> {
  const [row] = await exec
    .insert(secureLinks)
    .values({
      linkId: input.linkId,
      formId: input.formId,
      expiresAt: input.expiresAt,
      environment: input.environment,
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
 * List the secure links minted for a form **in one environment**, newest first
 * (task 024, environment-scoped by task 066). Returns the raw rows - the admin slice
 * derives display state (active/consumed/expired/revoked) from
 * `consumedAt`/`revokedAt`/`expiresAt` against the request clock; storage stays
 * shape-preserving (R5).
 *
 * `environment` is required rather than optional, and that is the same choice Q19 makes
 * for minting one layer up: a links screen that quietly listed every environment's links
 * under a banner naming one would be showing an operator production links while they
 * believed they were looking at `test`. A caller that wants two environments asks twice.
 */
export async function listSecureLinks(
  exec: Executor,
  formId: FormId,
  environment: string,
): Promise<SecureLinkRow[]> {
  return exec
    .select()
    .from(secureLinks)
    .where(and(eq(secureLinks.formId, formId), eq(secureLinks.environment, environment)))
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
 *
 * Form-scoped (#478, following #305) **and environment-scoped** (task 066). Both join
 * the `where` clause, so a link belonging to another form - or to another environment -
 * is a row this statement never matches rather than one the caller checks after the fact.
 * Refusal therefore falls out of the query: a cross-form link, a cross-environment link,
 * a never-issued link and an already-revoked link all come back `undefined`, and the
 * caller has one code to answer with instead of error paths that have to agree.
 *
 * The environment scope is what keeps the links screen coherent: an administrator revokes
 * what the environment they are looking at listed, and a link in another environment is
 * not revocable from here any more than one in another form is.
 */
export async function revokeSecureLink(
  exec: Executor,
  linkId: LinkId,
  formId: FormId,
  environment: string,
  now?: Date,
): Promise<SecureLinkRow | undefined> {
  const [row] = await exec
    .update(secureLinks)
    .set({ revokedAt: now ?? new Date() })
    .where(
      and(
        eq(secureLinks.linkId, linkId),
        eq(secureLinks.formId, formId),
        eq(secureLinks.environment, environment),
        isNull(secureLinks.revokedAt),
      ),
    )
    .returning();
  return row;
}
