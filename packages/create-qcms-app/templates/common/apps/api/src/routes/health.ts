// Both probes are mounted in every process shape and require no credential. A dependency
// that is down or slow answers 503 with a clean body, never a 500: it is an expected state.

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

/** Never rejects: a probe failure is an answer, not an error for the envelope. */
async function probeDb(deps: Deps): Promise<boolean> {
  const timeoutMs = deps.config.readiness.dbTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const probe = deps.databases.control
    .execute(sql`select 1`)
    .then(() => true)
    .catch(() => false);
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
