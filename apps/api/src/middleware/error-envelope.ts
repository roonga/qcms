/**
 * The error envelope (task 017).
 *
 * One `onError` handler turns every value thrown out of a route or middleware
 * into the uniform shape `{ error: { code, message, details? } }`:
 *
 * - An {@link ApiError} is deliberate and client-safe → its code/message/details
 *   at its status.
 * - Anything else is unexpected (a bug, a driver throw) → an opaque **500 with a
 *   correlation id**. The full error (with stack) is logged; the body carries
 *   only the id, never internals (SEC-8 hygiene - internals never leak).
 *
 * Hono's own `HTTPException` (e.g. a body-limit rejection) is honoured with its
 * status but rendered through the same envelope.
 *
 * **"Thrown" is the operative word, and it is not the same as "every refusal"**
 * (issue #182). A failure that is *returned* as a `Response` rather than thrown
 * goes around this handler entirely, keeping whatever body produced it. That is
 * exactly what `@hono/zod-openapi`'s request validator does by default, which is
 * why `app.ts` gives every `OpenAPIHono` a `defaultHook`
 * (`middleware/validation-hook.ts`) that throws an `ApiError` instead: the hook
 * is what puts route-schema refusals on this path. Anything else added below the
 * composition root that answers a request itself needs the same treatment - a
 * `Response` this handler never sees is a `Response` nothing here guarantees.
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
      // Deliberate, client-safe. Log at warn for the auth/limit signal.
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

    // Unexpected: log with stack + id; return an opaque 500 (no internals).
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
