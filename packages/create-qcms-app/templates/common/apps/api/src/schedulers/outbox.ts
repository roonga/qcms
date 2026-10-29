/** Started only by `serve.ts` under the internal mount flag: one deliverer per process. */

import type { Deps } from "../deps.js";
import { createIntervalScheduler, type Scheduler } from "./scheduler.js";

export type OutboxDeliver = (deps: Deps) => Promise<void>;

const noopDeliver: OutboxDeliver = () => Promise.resolve();

export function createOutboxScheduler(deps: Deps, deliver: OutboxDeliver = noopDeliver): Scheduler {
  return createIntervalScheduler({
    name: "outbox-deliverer",
    intervalMs: deps.config.scheduler.outboxIntervalMs,
    jitterMs: deps.config.scheduler.outboxJitterMs,
    logger: deps.logger,
    task: () => deliver(deps),
  });
}
