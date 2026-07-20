/**
 * Retention-sweep scheduler (task 017; ARCHITECTURE §5.3).
 *
 * Periodically expires abandoned sessions by calling @qcms/db's
 * `sweepExpiredSessions` (task 015) with the injected clock. The scheduling is
 * the API's job; the sweep semantics (which rows, the boundary) live in the db
 * package. Gated by the mount flags in `serve.ts` (internal process only).
 */

import { sweepExpiredSessions } from "@qcms/db";

import type { Deps } from "../deps.js";
import { createIntervalScheduler, type Scheduler } from "./scheduler.js";

export function createRetentionSweepScheduler(deps: Deps): Scheduler {
  return createIntervalScheduler({
    name: "retention-sweep",
    intervalMs: deps.config.scheduler.retentionSweepIntervalMs,
    logger: deps.logger,
    task: async () => {
      const result = await sweepExpiredSessions(deps.db, deps.clock.now());
      if (result.expiredCount > 0) {
        deps.logger.info("retention sweep", { expiredCount: result.expiredCount });
      }
    },
  });
}
