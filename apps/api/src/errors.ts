// Anything not wrapped in `ApiError` renders as an opaque 500: internals never reach
// the response body (SEC-8).

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503;

/** Mirrored by the Zod schema in openapi.ts. */
export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: ApiErrorStatus;
  /** Client-safe only: never secrets. */
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

export const errors = {
  unauthorized: (message = "Unauthorized"): ApiError => new ApiError("unauthorized", 401, message),
  tooManyRequests: (message = "Too Many Requests", details?: unknown): ApiError =>
    new ApiError("rate_limited", 429, message, details),
  payloadTooLarge: (message = "Payload Too Large"): ApiError =>
    new ApiError("payload_too_large", 413, message),
} as const;
