/**
 * Liveness and readiness (task 017; ARCHITECTURE §5.1).
 *
 * Both are mounted in every process shape and require no credential (they are
 * liveness/readiness signals for orchestrators and monitors):
 *
 * - `/health` - static `ok`. The process is up and serving.
 * - `/ready` - probes the database with a bounded timeout. Ready → 200; a DB
 *   that is down or slow → **503 with a clean body** (never a 500 - a failing
 *   dependency is an expected state, not a crash).
 *
 * Declared with `createRoute` (017's convention); the handlers are fetch-pure.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { sql } from "drizzle-orm";

import type { Deps } from "../deps.js";
import type { ApiEnv } from "../openapi.js";

const HealthResponse = z.object({ status: z.literal("ok") }).openapi("HealthResponse");

const ReadyResponse = z
  .object({
    status: z.enum(["ready", "unavailable"]),
    checks: z.object({ db: z.enum(["ok", "down"]) }),
  })
  .openapi("ReadyResponse");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Liveness probe",
  tags: ["ops"],
  responses: {
    200: {
      description: "Process is up",
      content: { "application/json": { schema: HealthResponse } },
    },
  },
});

const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  summary: "Readiness probe (checks the database)",
  tags: ["ops"],
  responses: {
    200: {
      description: "Dependencies reachable",
      content: { "application/json": { schema: ReadyResponse } },
    },
    503: {
      description: "A dependency is unavailable",
      content: { "application/json": { schema: ReadyResponse } },
    },
  },
});

/** Race a DB round-trip against a timeout; resolve true/false, never reject. */
async function probeDb(deps: Deps): Promise<boolean> {
  const timeoutMs = deps.config.readiness.dbTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const probe = deps.db
    .execute(sql`select 1`)
    .then(() => true)
    .catch(() => false);
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Register `/health` and `/ready` on the given app. */
export function registerHealthRoutes(app: OpenAPIHono<ApiEnv>, deps: Deps): void {
  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

  app.openapi(readyRoute, async (c) => {
    const dbOk = await probeDb(deps);
    if (dbOk) {
      return c.json({ status: "ready" as const, checks: { db: "ok" as const } }, 200);
    }
    return c.json({ status: "unavailable" as const, checks: { db: "down" as const } }, 503);
  });
}
