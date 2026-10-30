import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { systemClock } from "./clock.js";
import { logSignInThrottleState, warnIfBreachCheckDisabled } from "./features/auth/instance.js";
import { adminAuthFor } from "./features/auth/route.js";
import { selectDraftAssistant } from "./features/agent/assistant.js";
import { selectChallengeVerifier } from "./features/responses/challenge.js";
import { appGroups } from "./registrars.js";
import { loadConfig, turnstileSiteKeyDeprecationWarning } from "./config.js";
import type { Deps } from "./deps.js";
import {
  EnvironmentSetMismatchError,
  assertEnvironmentsMatch,
  openDatabases,
} from "./environments.js";
import { createJsonLogger } from "./logger.js";
import { InMemoryRateLimitStore } from "./rate-limit.js";
import { createOutboxScheduler } from "./schedulers/outbox.js";
import { runDeliveryPassForEveryEnvironment } from "./schedulers/outbox-delivery.js";
import { createRetentionSweepScheduler } from "./schedulers/retention-sweep.js";
import type { Scheduler } from "./schedulers/scheduler.js";
import type { Telemetry } from "./telemetry.js";

export function main(telemetry: Telemetry): void {
  const config = loadConfig(process.env);

  const logger = createJsonLogger({
    write: (line) => process.stdout.write(line + "\n"),
    base: { service: "qcms-api" },
    sendToOpenTelemetry: true,
  });

  // At boot, not on the lazy auth build: a disabled SEC-1 breach check must show in the
  // startup log rather than at the first sign-in attempt.
  if (config.mount.admin) {
    warnIfBreachCheckDisabled(config.adminAuth, (message) => {
      logger.warn(message);
    });
  }

  // Unconditional on mount and on the challenge flag: the deprecation notice has to reach
  // an operator who still has the old variable set. The value is never echoed (SEC-8).
  const turnstileWarning = turnstileSiteKeyDeprecationWarning(process.env);
  if (turnstileWarning !== undefined) logger.warn(turnstileWarning);

  // Each pool connects as its own role with its own search path, so which environment a
  // handler can reach is enforced by the database, not by convention (ADR-40).
  const { databases, pools } = openDatabases(config);

  // A set mismatch is fatal (ADR-24 fails fast on bad deployment config) but a failed read
  // is not: a database that is not up yet is the ordinary case and `/ready` reports it.
  // Not awaited before the bind, so a cold database still leaves a port answering `/ready`.
  void assertEnvironmentsMatch(databases).catch((error: unknown) => {
    if (error instanceof EnvironmentSetMismatchError) {
      logger.error("the environment set and the configuration disagree", { err: error });
      process.exit(1);
    }
    logger.warn("could not check the environment set against control.environments", {
      err: error,
    });
  });

  const deps: Deps = {
    databases,
    config,
    clock: systemClock,
    logger,
    rateLimitStore: new InMemoryRateLimitStore(systemClock),
    challenge: selectChallengeVerifier(config, logger),
    draftAssistant: selectDraftAssistant(config, logger),
    flags: config.flags,
  };

  const app = createApp(deps, config.mount, { groups: appGroups });

  // Read off the limiter's own resolved context, so a disabled SEC-1 sign-in throttle is
  // visible without exhausting the limit. Off to the side of the bind and its failure only
  // logged: a safety diagnostic must not become a new way to fail to start.
  if (config.mount.admin) {
    void logSignInThrottleState(adminAuthFor(deps), logger).catch((error: unknown) => {
      logger.error("could not read the sign-in throttle state", { err: error });
    });
  }

  // Schedulers must be a singleton, so only the internal surface starts them.
  const schedulers: Scheduler[] = [];
  if (config.mount.internal) {
    schedulers.push(
      createRetentionSweepScheduler(deps),
      // One scheduler iterating the live environment set, not one per environment, so the
      // singleton rule holds.
      createOutboxScheduler(deps, (d) => runDeliveryPassForEveryEnvironment(d)),
    );
    for (const scheduler of schedulers) scheduler.start();
  }

  const port = Number(process.env.PORT ?? process.env.QCMS_PORT ?? 3000);
  const server = serve({ fetch: app.fetch, port }, (info) => {
    logger.info("listening", {
      port: info.port,
      mount: config.mount,
      tracing: telemetry.enabled,
    });
  });

  let shuttingDown = false;
  // Hoisted out of the `server.close` callback to stay under the function nesting limit.
  const finishShutdown = async (signal: string): Promise<void> => {
    await Promise.all(schedulers.map((s) => s.stop()));
    await Promise.all(pools.map((pool) => pool.end()));
    logger.info("shutdown complete", { signal });
    // Telemetry last, so the lines above are still correlated and the final spans export.
    await telemetry.shutdown();
    process.exit(0);
  };
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    server.close(() => {
      void finishShutdown(signal);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
