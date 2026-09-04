/**
 * Request logging + correlation id (task 017; span attribute added by task 054).
 *
 * Assigns each request a correlation id (honouring an inbound `x-request-id`,
 * else generating one via WebCrypto - fetch-pure, R4), stores it on the context
 * for handlers and the error envelope, echoes it as a response header, and logs
 * one structured line per request: id, method, path, status, duration. Answer
 * content is never touched - only method/path/status/timing.
 *
 * The id is also recorded on the active span as `qcms.request_id` (ADR-34, P5):
 * `x-request-id` stays the human-facing token a respondent or tester can quote,
 * and this is the join from that token to the trace. `@opentelemetry/api` is a
 * no-op when no SDK is registered, so the call costs nothing when tracing is off
 * and this middleware's behaviour is otherwise byte-identical to task 017's.
 */

import { trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import type { ApiEnv } from "../openapi.js";

/** The span attribute carrying the human-facing correlation id (SEC-13 allowlisted). */
export const REQUEST_ID_ATTRIBUTE = "qcms.request_id";

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
    trace.getActiveSpan()?.setAttribute(REQUEST_ID_ATTRIBUTE, requestId);

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
