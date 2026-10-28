/**
 * Started only by `serve.ts` under the internal mount flag. The session TTL is
 * deliberately not per environment: a session ages against its own `expires_at`,
 * written from the installation-wide value when it started.
 */

import {
  listEnvironmentRetention,
  redactAgedOutboxPayloads,
  redactAgedResponseSnippets,
  sweepExpiredSessions,
} from "@roonga/qcms-db";

import type { Deps } from "../deps.js";
import { createIntervalScheduler, type Scheduler } from "./scheduler.js";

interface RetentionWindows {
  readonly deliveryResponseSnippetMs: number;
  readonly outboxPayloadMs: number;
}

/**
 * A failed read throws rather than falling back to the installation-wide values: an
 * environment configured to drop a response body now must not quietly keep it for
 * days with nothing saying the configured policy did not run.
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
 * Sequential, so one environment's slow sweep cannot starve another's pool. Unlike the
 * deliverer, a failing environment ends the pass: a retention rule that fails is a
 * policy that did not run, so the whole pass is retried on the next tick rather than
 * left half-applied and reported as done.
 */
export async function sweepEveryEnvironment(deps: Deps, now: Date): Promise<void> {
  const windows = await windowsForEveryEnvironment(deps);
  for (const environment of deps.databases.names) {
    // Unreachable: boot refuses when the pool set and `control.environments` disagree.
    // A fall back rather than a throw, so that refusal is not duplicated here.
    const window = windows.get(environment) ?? {
      deliveryResponseSnippetMs: deps.config.ttl.deliveryResponseSnippetMs,
      outboxPayloadMs: deps.config.ttl.outboxPayloadMs,
    };
    await sweepEnvironment(deps, environment, now, window);
  }
}

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
    // A count, never a snippet: these bytes can hold respondent content (SEC-13).
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
    // A count, never a payload: the member dropped is the respondent's answer set (SEC-13).
    deps.logger.info("outbox payload answers redacted", {
      environment,
      redactedCount: payloads.redactedCount,
    });
  }
}
