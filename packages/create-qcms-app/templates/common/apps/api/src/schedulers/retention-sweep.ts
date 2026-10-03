/**
 * Retention-sweep scheduler (task 017; ARCHITECTURE §5.3).
 *
 * The API's one home for time-based data policy. Each pass runs every retention
 * rule the deployment has; the scheduling is the API's job, and the semantics of
 * each rule (which rows, where the boundary is) live in @roonga/qcms-db. Gated by the
 * mount flags in `serve.ts` (internal process only).
 *
 * Three rules today:
 *
 * - `sweepExpiredSessions` (task 015) - abandoned sessions become `expired`.
 * - `redactAgedResponseSnippets` (issue #304) - webhook delivery rows lose the
 *   stored prefix of the consumer's response body once its diagnostic window has
 *   passed.
 * - `redactAgedOutboxPayloads` (issue #329) - a settled outbox event loses the
 *   answers its payload carries once the redelivery window that payload exists to
 *   serve has closed.
 *
 * Each rides this scheduler rather than getting one of its own: a second timer for a
 * second retention rule is a second thing to configure, mount, log and reason about,
 * for no behaviour a shared pass does not already give. One sweep with three jobs is
 * auditable; three sweeps drift.
 */

import {
  redactAgedOutboxPayloads,
  redactAgedResponseSnippets,
  sweepExpiredSessions,
} from "@roonga/qcms-db";

import type { Deps } from "../deps.js";
import { createIntervalScheduler, type Scheduler } from "./scheduler.js";

export function createRetentionSweepScheduler(deps: Deps): Scheduler {
  return createIntervalScheduler({
    name: "retention-sweep",
    intervalMs: deps.config.scheduler.retentionSweepIntervalMs,
    logger: deps.logger,
    task: async () => {
      const now = deps.clock.now();
      // **The scheduler starts once and iterates the live set** (Q1, Q2, criterion 9).
      // One process, one scheduler, N environments: the singleton rule in
      // `docs/deploy-enterprise.md` holds unchanged rather than multiplying per
      // environment, and an environment added by the operator command is swept after a
      // restart without a code change. Sequential rather than concurrent, so one
      // environment's slow sweep cannot starve the pool of another.
      for (const environment of deps.databases.names) {
        await sweepEnvironment(deps, environment, now);
      }
    },
  });
}

/** One environment's whole sweep: expiry, snippets, payloads. */
async function sweepEnvironment(deps: Deps, environment: string, now: Date): Promise<void> {
  const exec = deps.databases.for(environment);
  const result = await sweepExpiredSessions(exec, now);
  if (result.expiredCount > 0) {
    deps.logger.info("retention sweep", { environment, expiredCount: result.expiredCount });
  }
  const snippets = await redactAgedResponseSnippets(
    exec,
    new Date(now.getTime() - deps.config.ttl.deliveryResponseSnippetMs),
  );
  if (snippets.redactedCount > 0) {
    // A count, never a snippet: the whole point of the sweep is that these bytes
    // can hold respondent content, so logging one would defeat it (SEC-13, and
    // "answer values are never logged").
    deps.logger.info("delivery response snippets redacted", {
      environment,
      redactedCount: snippets.redactedCount,
    });
  }
  const payloads = await redactAgedOutboxPayloads(
    exec,
    new Date(now.getTime() - deps.config.ttl.outboxPayloadMs),
  );
  if (payloads.redactedCount > 0) {
    // A count, never a payload: the member being dropped is the respondent's
    // whole locked answer set, so logging one would defeat the sweep (SEC-13,
    // and "answer values are never logged").
    deps.logger.info("outbox payload answers redacted", {
      environment,
      redactedCount: payloads.redactedCount,
    });
  }
}
