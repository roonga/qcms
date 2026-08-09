/**
 * Retention-sweep scheduler (task 017; ARCHITECTURE §5.3).
 *
 * The API's one home for time-based data policy. Each pass runs every retention
 * rule the deployment has; the scheduling is the API's job, and the semantics of
 * each rule (which rows, where the boundary is) live in @roonga/qcms-db. Gated by the
 * mount flags in `serve.ts` (internal process only).
 *
 * Two rules today:
 *
 * - `sweepExpiredSessions` (task 015) - abandoned sessions become `expired`.
 * - `redactAgedResponseSnippets` (issue #304) - webhook delivery rows lose the
 *   stored prefix of the consumer's response body once its diagnostic window has
 *   passed. It rides this scheduler rather than getting one of its own: a second
 *   timer for a second retention rule is a second thing to configure, mount, log
 *   and reason about, for no behaviour a shared pass does not already give.
 */

import { redactAgedResponseSnippets, sweepExpiredSessions } from "@roonga/qcms-db";

import type { Deps } from "../deps.js";
import { createIntervalScheduler, type Scheduler } from "./scheduler.js";

export function createRetentionSweepScheduler(deps: Deps): Scheduler {
  return createIntervalScheduler({
    name: "retention-sweep",
    intervalMs: deps.config.scheduler.retentionSweepIntervalMs,
    logger: deps.logger,
    task: async () => {
      const now = deps.clock.now();
      const result = await sweepExpiredSessions(deps.db, now);
      if (result.expiredCount > 0) {
        deps.logger.info("retention sweep", { expiredCount: result.expiredCount });
      }
      const snippets = await redactAgedResponseSnippets(
        deps.db,
        new Date(now.getTime() - deps.config.ttl.deliveryResponseSnippetMs),
      );
      if (snippets.redactedCount > 0) {
        // A count, never a snippet: the whole point of the sweep is that these bytes
        // can hold respondent content, so logging one would defeat it (SEC-13, and
        // "answer values are never logged").
        deps.logger.info("delivery response snippets redacted", {
          redactedCount: snippets.redactedCount,
        });
      }
    },
  });
}
