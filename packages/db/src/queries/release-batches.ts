import { and, eq, lt } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import { releaseBatches } from "../schema/index.js";
import type { Executor } from "./executor.js";

/** Retention for a stored confirmation result. */
export const RELEASE_BATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** One stored confirmation result. */
export interface ReleaseBatchRow {
  readonly principalId: string;
  readonly formId: FormId;
  readonly idempotencyKey: string;
  readonly intentHash: string;
  readonly result: unknown;
  readonly createdAt: Date;
}

/**
 * The stored result for one (principal, form, key), or `undefined`. The key is scoped to
 * the principal, so another account cannot replay a result it did not create.
 */
export async function getReleaseBatch(
  exec: Executor,
  input: {
    readonly principalId: string;
    readonly formId: FormId;
    readonly idempotencyKey: string;
  },
): Promise<ReleaseBatchRow | undefined> {
  const [row] = await exec
    .select()
    .from(releaseBatches)
    .where(
      and(
        eq(releaseBatches.principalId, input.principalId),
        eq(releaseBatches.formId, input.formId),
        eq(releaseBatches.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  return row;
}

/** Store one successful confirmation. Call inside the confirmation's own transaction. */
export async function insertReleaseBatch(
  exec: Executor,
  input: {
    readonly principalId: string;
    readonly formId: FormId;
    readonly idempotencyKey: string;
    readonly intentHash: string;
    readonly result: unknown;
    readonly createdAt?: Date;
  },
): Promise<void> {
  await exec.insert(releaseBatches).values({
    principalId: input.principalId,
    formId: input.formId,
    idempotencyKey: input.idempotencyKey,
    intentHash: input.intentHash,
    result: input.result,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
}

/** Outcome of one retention pass over the stored results. */
export interface ReleaseBatchPurgeResult {
  readonly purgedCount: number;
}

/**
 * Remove stored results written before `olderThan`. The release history is the long-term
 * answer; these rows only let a reloaded client find an outcome it already caused.
 */
export async function purgeExpiredReleaseBatches(
  exec: Executor,
  olderThan: Date,
): Promise<ReleaseBatchPurgeResult> {
  const purged = await exec
    .delete(releaseBatches)
    .where(lt(releaseBatches.createdAt, olderThan))
    .returning({ idempotencyKey: releaseBatches.idempotencyKey });
  return { purgedCount: purged.length };
}
