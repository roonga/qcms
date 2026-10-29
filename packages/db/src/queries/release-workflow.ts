import { desc, eq, sql } from "drizzle-orm";

import { releaseWorkflowRevisions, releaseWorkflowRules } from "../schema/index.js";
import type { Executor } from "./executor.js";

/** One destination's configured rule. */
export interface ReleaseWorkflowRule {
  readonly environment: string;
  readonly requiresPriorReleaseIn: readonly string[];
  readonly allowsDraftPublish: boolean;
  readonly allowsInBatch: boolean;
}

/** A revision and the rules it carries. */
export interface ReleaseWorkflowRevision {
  readonly revision: number;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly note: string | null;
  readonly rules: readonly ReleaseWorkflowRule[];
}

/** The newest revision number, or `undefined` while none is configured. */
export async function latestReleaseWorkflowRevision(exec: Executor): Promise<number | undefined> {
  const [row] = await exec
    .select({ revision: releaseWorkflowRevisions.revision })
    .from(releaseWorkflowRevisions)
    .orderBy(desc(releaseWorkflowRevisions.revision))
    .limit(1);
  return row === undefined ? undefined : Number(row.revision);
}

/**
 * The effective revision and its rules, or `undefined` while none is configured, which is
 * the deployment's derived default rather than an empty rule set.
 */
export async function effectiveReleaseWorkflow(
  exec: Executor,
): Promise<ReleaseWorkflowRevision | undefined> {
  const [head] = await exec
    .select()
    .from(releaseWorkflowRevisions)
    .orderBy(desc(releaseWorkflowRevisions.revision))
    .limit(1);
  if (head === undefined) return undefined;
  const rules = await exec
    .select()
    .from(releaseWorkflowRules)
    .where(eq(releaseWorkflowRules.revision, head.revision))
    .orderBy(releaseWorkflowRules.environment);
  return {
    revision: Number(head.revision),
    createdAt: head.createdAt,
    createdBy: head.createdBy,
    note: head.note,
    rules: rules.map((row) => ({
      environment: row.environment,
      requiresPriorReleaseIn: row.requiresPriorReleaseIn,
      allowsDraftPublish: row.allowsDraftPublish,
      allowsInBatch: row.allowsInBatch,
    })),
  };
}

/**
 * Append the next revision and its rules. The number is assigned by a scalar subquery, so
 * two concurrent writes cannot claim one; the loser violates the primary key. Call inside
 * the caller's transaction, beside the audit row.
 */
export async function insertReleaseWorkflowRevision(
  exec: Executor,
  input: {
    readonly createdBy: string;
    readonly note?: string | null;
    readonly rules: readonly ReleaseWorkflowRule[];
    readonly createdAt?: Date;
  },
): Promise<ReleaseWorkflowRevision> {
  const [head] = await exec
    .insert(releaseWorkflowRevisions)
    .values({
      revision: sql<number>`(select coalesce(max(${releaseWorkflowRevisions.revision}), 0) + 1
        from ${releaseWorkflowRevisions})`,
      createdBy: input.createdBy,
      note: input.note ?? null,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    })
    .returning();
  const revision = Number(head!.revision);
  if (input.rules.length > 0) {
    await exec.insert(releaseWorkflowRules).values(
      input.rules.map((rule) => ({
        revision,
        environment: rule.environment,
        requiresPriorReleaseIn: [...rule.requiresPriorReleaseIn],
        allowsDraftPublish: rule.allowsDraftPublish,
        allowsInBatch: rule.allowsInBatch,
      })),
    );
  }
  return {
    revision,
    createdAt: head!.createdAt,
    createdBy: head!.createdBy,
    note: head!.note,
    rules: input.rules.map((rule) => ({ ...rule })),
  };
}
