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
 *
 * ## The two redaction windows are per environment (Q11, ADR-24's amendment, task 067)
 *
 * `control.environments` carries `delivery_snippet_ttl_ms` and `outbox_payload_ttl_ms`,
 * either of which may be `NULL`, and `NULL` means the installation-wide typed value
 * stands. This is the reader, because the sweep is what ages a row against them: a test
 * environment that keeps a consumer's response body for seven days, or a second copy of a
 * tester's answers for thirty, is a cost with no benefit.
 *
 * **The session TTL is not one of them**, and that is a decision rather than an omission:
 * Q11's per-environment set is the retention TTLs and the challenge provider, and the
 * session TTL stays installation-wide with the rate limits and the anti-abuse thresholds
 * (finding 6). `sweepExpiredSessions` ages against each session's own `expires_at`, which
 * was written from the installation-wide value when the session started, so there is
 * nothing per environment for this pass to read for it even if there were a column.
 */

import {
  listEnvironmentRetention,
  redactAgedOutboxPayloads,
  redactAgedResponseSnippets,
  sweepExpiredSessions,
} from "@roonga/qcms-db";

import type { Deps } from "../deps.js";
import { createIntervalScheduler, type Scheduler } from "./scheduler.js";

/** The two windows one environment's pass ages rows against, in milliseconds. */
interface RetentionWindows {
  readonly deliveryResponseSnippetMs: number;
  readonly outboxPayloadMs: number;
}

/**
 * The windows for every environment in the live set: the row's override where it has one,
 * and the installation-wide typed value where it does not.
 *
 * Read once per pass, on the **control** pool, rather than once per environment: it is two
 * numbers per environment out of one table, and the sweep already holds that connection
 * before it picks an environment.
 *
 * **A failed read is not a silent fall back to the installation-wide values.** It throws,
 * the scheduler logs the rejection and the whole pass is retried on the next tick. The
 * alternative reads as resilience and is not: an environment configured to drop a
 * consumer's response body at the next sweep would quietly keep it for seven days, and
 * nothing anywhere would say that the policy an operator configured was not the policy
 * that ran.
 */
async function windowsForEveryEnvironment(deps: Deps): Promise<Map<string, RetentionWindows>> {
  const rows = await listEnvironmentRetention(deps.databases.control);
  return new Map(
    rows.map((row) => [
      row.name,
      {
        deliveryResponseSnippetMs:
          row.deliverySnippetTtlMs ?? deps.config.ttl.deliveryResponseSnippetMs,
        outboxPayloadMs: row.outboxPayloadTtlMs ?? deps.config.ttl.outboxPayloadMs,
      },
    ]),
  );
}

export function createRetentionSweepScheduler(deps: Deps): Scheduler {
  return createIntervalScheduler({
    name: "retention-sweep",
    intervalMs: deps.config.scheduler.retentionSweepIntervalMs,
    logger: deps.logger,
    task: async () => {
      await sweepEveryEnvironment(deps, deps.clock.now());
    },
  });
}

/**
 * One whole sweep: every retention rule, in every environment in the live set (Q1, Q2,
 * criterion 9).
 *
 * **The scheduler starts once and iterates.** One process, one scheduler, N
 * environments: the singleton rule in `docs/deploy-enterprise.md` holds unchanged rather
 * than multiplying per environment, and an environment added by the operator command is
 * swept after a restart without a code change. Sequential rather than concurrent, so one
 * environment's slow sweep cannot starve the pool of another.
 *
 * Exported so criterion 9 is asserted rather than described: a loop buried inside a
 * timer's callback can only be tested by driving the timer, and what the criterion is
 * about is which environments the pass reaches. `runDeliveryPassForEveryEnvironment` is
 * the deliverer's counterpart and is exported for the same reason.
 *
 * **Unlike the deliverer, this does not step over a failing environment.** The deliverer
 * catches per environment because a queue that stops draining is an outage in the
 * environment it stops in; a retention rule that fails is a policy that did not run, and
 * the pass is retried whole on the next tick rather than half-applied and reported as
 * done. `createIntervalScheduler` logs the rejection and keeps scheduling.
 */
export async function sweepEveryEnvironment(deps: Deps, now: Date): Promise<void> {
  const windows = await windowsForEveryEnvironment(deps);
  for (const environment of deps.databases.names) {
    // An environment this process holds a pool for but `control.environments` does not
    // list cannot occur: task 064's criterion 6a refuses the boot when the two lists
    // disagree, in both directions. The installation-wide pair is the fall back here
    // rather than a throw because the alternative would make a disagreement this process
    // has already refused to boot on into a second, later failure.
    const window = windows.get(environment) ?? {
      deliveryResponseSnippetMs: deps.config.ttl.deliveryResponseSnippetMs,
      outboxPayloadMs: deps.config.ttl.outboxPayloadMs,
    };
    await sweepEnvironment(deps, environment, now, window);
  }
}

/** One environment's whole sweep: expiry, snippets, payloads. */
async function sweepEnvironment(
  deps: Deps,
  environment: string,
  now: Date,
  window: RetentionWindows,
): Promise<void> {
  const exec = deps.databases.for(environment);
  const result = await sweepExpiredSessions(exec, now);
  if (result.expiredCount > 0) {
    deps.logger.info("retention sweep", { environment, expiredCount: result.expiredCount });
  }
  const snippets = await redactAgedResponseSnippets(
    exec,
    new Date(now.getTime() - window.deliveryResponseSnippetMs),
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
    new Date(now.getTime() - window.outboxPayloadMs),
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
