/**
 * Only *thrown* failures reach here: anything that returns a `Response` itself keeps
 * its own body, which is why every `OpenAPIHono` gets a throwing `defaultHook`.
 */

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Deps } from "../deps.js";
import { ApiError, type ErrorEnvelope } from "../errors.js";
import type { ApiEnv } from "../openapi.js";

function newErrorId(): string {
  return crypto.randomUUID();
}

export function errorEnvelope(deps: Deps) {
  return (err: Error, c: Context<ApiEnv>): Response => {
    const requestId = c.get("requestId");

    if (err instanceof ApiError) {
      deps.logger.warn("handled error", {
        requestId,
        code: err.code,
        status: err.status,
      });
      return c.json(err.toEnvelope(), err.status);
    }

    if (err instanceof HTTPException) {
      const body: ErrorEnvelope = {
        error: { code: "http_error", message: err.message || "Error" },
      };
      deps.logger.warn("http exception", { requestId, status: err.status });
      return c.json(body, err.status);
    }

    // The body carries only the correlation id, never internals (SEC-8).
    const errorId = newErrorId();
    deps.logger.error("unhandled error", { requestId, errorId, err });
    const body: ErrorEnvelope = {
      error: {
        code: "internal",
        message: "Internal Server Error",
        details: { errorId },
      },
    };
    return c.json(body, 500);
  };
}
