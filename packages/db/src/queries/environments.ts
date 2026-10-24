import { asc, eq } from "drizzle-orm";

import { environments } from "../schema/index.js";
import type { Executor } from "./executor.js";

/** One row of the live environment set. */
export interface EnvironmentRow {
  readonly name: string;
  readonly position: number;
}

/**
 * The live environment set, in `position` order. This table is the source of the set, not
 * the pools a caller happens to hold, and every role may read it on any pool.
 */
export async function listEnvironments(exec: Executor): Promise<EnvironmentRow[]> {
  return exec
    .select({ name: environments.name, position: environments.position })
    .from(environments)
    .orderBy(asc(environments.position));
}

/**
 * One environment's challenge provider, or `null` to use the installation-wide value.
 * `undefined` means no such environment row exists, which is a configuration fault.
 */
export async function getEnvironmentChallengeProvider(
  exec: Executor,
  name: string,
): Promise<string | null | undefined> {
  const [row] = await exec
    .select({ challengeProvider: environments.challengeProvider })
    .from(environments)
    .where(eq(environments.name, name))
    .limit(1);
  return row === undefined ? undefined : row.challengeProvider;
}

/** One environment's retention TTL overrides, or `null` where the deployment's stand. */
export interface EnvironmentRetentionRow {
  readonly name: string;
  /** Overrides `QCMS_DELIVERY_SNIPPET_TTL_MS`, or `null` to use it. */
  readonly deliverySnippetTtlMs: number | null;
  /** Overrides `QCMS_OUTBOX_PAYLOAD_TTL_MS`, or `null` to use it. */
  readonly outboxPayloadTtlMs: number | null;
}

/** Every environment's retention TTL overrides, in `position` order. */
export async function listEnvironmentRetention(exec: Executor): Promise<EnvironmentRetentionRow[]> {
  return exec
    .select({
      name: environments.name,
      deliverySnippetTtlMs: environments.deliverySnippetTtlMs,
      outboxPayloadTtlMs: environments.outboxPayloadTtlMs,
    })
    .from(environments)
    .orderBy(asc(environments.position));
}
