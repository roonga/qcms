/**
 * The route-schema validation hook (issue #182).
 *
 * `@hono/zod-openapi` validates a request against the route's Zod schemas
 * before the handler runs. Construct an `OpenAPIHono` with no `defaultHook` and
 * its validator answers a failure itself - `c.json({ success: false, error }, 400)`
 * - which has two consequences the rest of this codebase does not survive:
 *
 * - The response is **returned, not thrown**, so `onError` never sees it. The
 *   body is a serialized `ZodError` rather than the `ErrorEnvelope` every route
 *   documents in `docs/openapi/*.json`, and a client keying off `error.code`
 *   reads `undefined`.
 * - That body **echoes submitted input**: a Zod `unrecognized_keys` issue names
 *   the keys it was sent, and nothing stops a future issue kind carrying the
 *   value itself. SEC-8 and SEC-13 both say a refusal never carries the value
 *   that caused it.
 *
 * So this hook is installed as the `defaultHook` at every `OpenAPIHono`
 * construction site in `app.ts`, and it **throws** the deliberate {@link ApiError}
 * the envelope middleware already knows how to render. Validation refusals then
 * take the same path, the same body shape and the same `warn` log line as every
 * other client-safe failure.
 *
 * What the body carries is the *location* of each failure plus Zod's own issue
 * code, never the input - the same house style `config.ts` uses for a boot
 * failure, where the message names the variable and the constraint and never
 * the value.
 */

import type { ValidationTargets } from "hono";
import type { ZodError } from "zod";

import { ApiError } from "../errors.js";

/** The envelope code a client keys off for a route-schema refusal. */
export const INVALID_REQUEST = "INVALID_REQUEST";

/**
 * Cap on reported issues. Enough to fix a request by hand, bounded so a large
 * malformed body cannot turn one refusal into an unbounded response.
 */
const MAX_REPORTED_ISSUES = 20;

/** How an issue at the top of the validated value is named. */
const ROOT_PATH = "(root)";

/**
 * A path segment is reproduced only when it reads as a schema-declared field
 * name (or an array index). Normally that is exactly what it is - but a schema
 * built on `z.record` keys its children by whatever the caller sent, so the
 * shape of the segment is what decides, not its provenance. Anything else
 * becomes `*`, which keeps the location readable without echoing input.
 */
const FIELD_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** One reported failure: where it is and which Zod rule it broke. */
export interface ValidationIssueReport {
  /** Dotted path within the validated target, or `(root)`. */
  readonly path: string;
  /** Zod's issue code (`invalid_type`, `too_big`, `custom`, ...). */
  readonly code: string;
}

/** `details` of an {@link INVALID_REQUEST} envelope. */
export interface ValidationFailureDetails {
  /** Which part of the request failed: `json`, `param`, `query`, ... */
  readonly target: keyof ValidationTargets;
  readonly issues: readonly ValidationIssueReport[];
  /** Issues beyond {@link MAX_REPORTED_ISSUES}; absent when none were dropped. */
  readonly omitted?: number;
}

function safeSegment(segment: PropertyKey): string {
  const text = typeof segment === "symbol" ? "*" : String(segment);
  return FIELD_NAME.test(text) ? text : "*";
}

function safePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return ROOT_PATH;
  return path.map(safeSegment).join(".");
}

/**
 * The value-free {@link ApiError} for a failed request-schema validation.
 * Exported for the tests that pin the shape; production code reaches it through
 * {@link validationErrorHook}.
 */
export function invalidRequest(target: keyof ValidationTargets, error: ZodError): ApiError {
  const reported = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue): ValidationIssueReport => ({
      path: safePath(issue.path),
      code: issue.code,
    }));
  const omitted = error.issues.length - reported.length;
  const details: ValidationFailureDetails = {
    target,
    issues: reported,
    ...(omitted > 0 ? { omitted } : {}),
  };
  return new ApiError(
    INVALID_REQUEST,
    400,
    "The request does not match this route's schema",
    details,
  );
}

/**
 * The validator outcome `@hono/zod-openapi` hands a hook. Declared locally
 * rather than imported because the library's `Hook` type is parameterized over
 * the route's inferred input and exported only as part of it; this is the part
 * that matters here, and a narrower parameter still satisfies the wider one.
 */
type ValidationOutcome = { readonly target: keyof ValidationTargets } & (
  { readonly success: true } | { readonly success: false; readonly error: ZodError }
);

/**
 * The `defaultHook` for every `OpenAPIHono` in this app. Success falls through
 * to the handler; a failure throws, so the error envelope renders it.
 */
export function validationErrorHook(result: ValidationOutcome): void {
  if (result.success) return;
  throw invalidRequest(result.target, result.error);
}
