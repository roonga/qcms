import { and, desc, eq, isNull } from "drizzle-orm";

import type { FormId, LinkId } from "@roonga/qcms-core";

import { secureLinks } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * Server-side state for one secure link. Hand-authored: the branded-id columns degrade to an `error` type
 * through the emitted `.d.ts`.
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
   * `NOT NULL`, because the composite `(link_id, environment)` key a session references
   * is skipped entirely under `MATCH SIMPLE` when any referencing column is NULL.
   */
  environment: string;
}

export type _SecureLinkRowMatchesTable = AssignableTo<
  SecureLinkRow,
  typeof secureLinks.$inferSelect
> &
  AssignableTo<typeof secureLinks.$inferSelect, SecureLinkRow>;

/**
 * Insert server-side state for a secure link (SEC-2). `environment` has no default on
 * purpose: defaulting would hand a script that omitted the field a production link.
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
 * The secure links minted for a form in one environment, newest first; the caller derives display state
 * from the timestamps. `environment` is required: listing every environment's links under a banner naming
 * one would show production links as `test`.
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
 * Atomically consume a one-time secure link: where replay is stopped, since a valid
 * signature is never sufficient on its own (SEC-2). The compare-and-set lets exactly one
 * of two concurrent consumers win, and every loser gets `undefined`.
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
 * Revoke a secure link so it stops working immediately (SEC-2). Form- and
 * environment-scoped in the `where`, so a cross-form link, a cross-environment link, a
 * never-issued link and an already-revoked link all come back `undefined` alike.
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
