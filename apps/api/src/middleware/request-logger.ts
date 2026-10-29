/** The log line carries method, path, status and timing only: never answer content. */

import { trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import type { ApiEnv } from "../openapi.js";

/** Allowlisted under SEC-13: a correlation id names no respondent. */
export const REQUEST_ID_ATTRIBUTE = "qcms.request_id";

/** WebCrypto rather than `node:crypto`, to stay fetch-pure (R4). */
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
