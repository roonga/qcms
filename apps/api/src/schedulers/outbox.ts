/**
 * Outbox-deliverer scheduler shell (task 017; ARCHITECTURE §5.3).
 *
 * **Scheduling shell only.** The actual webhook delivery — claiming due rows
 * with `FOR UPDATE SKIP LOCKED`, HMAC request signing, exponential backoff,
 * dead-lettering — lands in task 025. Here we own the loop: a jittered interval
 * that invokes a `deliver` callback. 025 supplies the real callback; until then
 * the default is a no-op, so composing and starting the scheduler is safe and
 * testable now.
 *
 * Jitter matters: multiple API instances poll the same `outbox` table, and the
 * per-tick jitter spreads their polling so they do not stampede the claim query.
 * Gated by the mount flags in `serve.ts` (internal process only).
 */

import type { Deps } from "../deps.js";
import { createIntervalScheduler, type Scheduler } from "./scheduler.js";

/** The delivery step 025 implements; defaults to a no-op in the 017 shell. */
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
