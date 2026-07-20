/**
 * The API error model (task 017).
 *
 * `ApiError` is the one throwable a handler or middleware raises to produce a
 * deliberate, client-safe response. The error-envelope middleware turns it into
 * `{ error: { code, message, details? } }` at the carried status. Anything the
 * handler does *not* wrap in `ApiError` (a programming bug, a driver throw) is
 * treated as unexpected: the middleware logs it with a stack and an id and
 * returns an opaque 500 - internals never reach the body (SEC-8 hygiene).
 */

/** HTTP status codes the error model uses; kept as a plain number union. */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503;

/** The serialized envelope body shape (mirrored by the Zod schema in openapi.ts). */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

export class ApiError extends Error {
  /** Stable, machine-readable error code (e.g. `"unauthorized"`). */
  readonly code: string;
  /** HTTP status to respond with. */
  readonly status: ApiErrorStatus;
  /** Optional, client-safe structured detail - never secrets. */
  readonly details?: unknown;

  constructor(code: string, status: ApiErrorStatus, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
  }

  /** The client-safe envelope for this error. */
  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/** Convenience constructors for the codes this task raises. */
export const errors = {
  unauthorized: (message = "Unauthorized"): ApiError => new ApiError("unauthorized", 401, message),
  tooManyRequests: (message = "Too Many Requests", details?: unknown): ApiError =>
    new ApiError("rate_limited", 429, message, details),
  payloadTooLarge: (message = "Payload Too Large"): ApiError =>
    new ApiError("payload_too_large", 413, message),
} as const;
