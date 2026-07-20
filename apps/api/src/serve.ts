/**
 * Server entry (task 017; ARCHITECTURE §5.3).
 *
 * The composition root's *outermost* layer: read the environment, build the
 * real dependencies (a Postgres pool, the stdout JSON logger, the system
 * clock), create the app for this process shape, bind the port, and - only
 * here, never in `createApp` - start the background schedulers. Tests compose
 * apps without any of this; that separation is the point.
 *
 * This file is allowed Node built-ins (it is the process boundary, not handler
 * scope) - the fetch-purity rule (R4) governs handlers, which reach Node
 * capabilities only through injected interfaces (the logger, the clock, the db
 * handle built here).
 *
 * Graceful shutdown on SIGTERM/SIGINT: stop accepting new requests, let
 * in-flight requests and scheduler runs finish, then close the pool.
 */

import { serve } from "@hono/node-server";
import { schema } from "@qcms/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { createApp } from "./app.js";
import { systemClock } from "./clock.js";
import { selectChallengeVerifier } from "./features/responses/challenge.js";
import { appGroups } from "./registrars.js";
import { loadConfig } from "./config.js";
import type { Deps } from "./deps.js";
import { createJsonLogger } from "./logger.js";
import { InMemoryRateLimitStore } from "./rate-limit.js";
import { createOutboxScheduler } from "./schedulers/outbox.js";
import { runDeliveryPass } from "./schedulers/outbox-delivery.js";
import { createRetentionSweepScheduler } from "./schedulers/retention-sweep.js";
import type { Scheduler } from "./schedulers/scheduler.js";

const { Pool } = pg;

function main(): void {
  const config = loadConfig(process.env);

  const logger = createJsonLogger({
    write: (line) => process.stdout.write(line + "\n"),
    base: { service: "qcms-api" },
  });

  const pool = new Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool, { schema });

  const deps: Deps = {
    db,
    config,
    clock: systemClock,
    logger,
    rateLimitStore: new InMemoryRateLimitStore(systemClock),
    challenge: selectChallengeVerifier(config, logger),
    flags: config.flags,
  };

  const app = createApp(deps, config.mount, { groups: appGroups });

  // Schedulers run in the internal process only (enterprise topology; solo runs
  // one all-surface process which includes internal).
  const schedulers: Scheduler[] = [];
  if (config.mount.internal) {
    schedulers.push(
      createRetentionSweepScheduler(deps),
      // 025 supplies the real delivery pass to the 017 scheduler shell.
      createOutboxScheduler(deps, (d) => runDeliveryPass(d).then(() => undefined)),
    );
    for (const scheduler of schedulers) scheduler.start();
  }

  const port = Number(process.env.PORT ?? process.env.QCMS_PORT ?? 3000);
  const server = serve({ fetch: app.fetch, port }, (info) => {
    logger.info("listening", {
      port: info.port,
      mount: config.mount,
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    // 1. Stop intake and finish in-flight requests.
    server.close(() => {
      void (async () => {
        // 2. Stop schedulers (each waits for its in-flight run).
        await Promise.all(schedulers.map((s) => s.stop()));
        // 3. Close the database pool.
        await pool.end();
        logger.info("shutdown complete", { signal });
        process.exit(0);
      })();
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

try {
  main();
} catch (err: unknown) {
  // Boot failure (invalid config): report and exit non-zero. ConfigError
  // messages name env vars only - never secret values (SEC-8).
  process.stderr.write(
    `qcms-api failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
