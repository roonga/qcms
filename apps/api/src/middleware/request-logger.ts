/**
 * Request logging + correlation id (task 017).
 *
 * Assigns each request a correlation id (honouring an inbound `x-request-id`,
 * else generating one via WebCrypto - fetch-pure, R4), stores it on the context
 * for handlers and the error envelope, echoes it as a response header, and logs
 * one structured line per request: id, method, path, status, duration. Answer
 * content is never touched - only method/path/status/timing.
 */

import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import type { ApiEnv } from "../openapi.js";

/** Generate a correlation id using the Web Crypto API (no `node:crypto`). */
function newRequestId(): string {
  return crypto.randomUUID();
}

export function requestLogger(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const inbound = c.req.header("x-request-id");
    const requestId = inbound && inbound.length <= 200 ? inbound : newRequestId();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);

    const start = deps.clock.now().getTime();
    await next();
    const durationMs = deps.clock.now().getTime() - start;

    deps.logger.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    });
  };
}
