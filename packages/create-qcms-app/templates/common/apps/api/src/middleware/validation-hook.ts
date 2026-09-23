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
 * - That body **echoes submitted values**, unboundedly: nothing stops an issue
 *   kind carrying the value it rejected, at whatever length it arrived. SEC-8 and
 *   SEC-13 both say a refusal never carries the value that caused it.
 *
 * So this hook is installed as the `defaultHook` at every `OpenAPIHono`
 * construction site in `app.ts`, and it **throws** the deliberate {@link ApiError}
 * the envelope middleware already knows how to render. Validation refusals then
 * take the same path, the same body shape and the same `warn` log line as every
 * other client-safe failure.
 *
 * What the body carries is the *location* of each failure plus Zod's own issue
 * code, never the submitted value - the same house style `config.ts` uses for a
 * boot failure, where the message names the variable and the constraint and never
 * the value.
 *
 * **One exception, and it is deliberate: an unrecognized key is named** (Code
 * Owner, 2026-09-19, issue #893). Request bodies reject unknown keys, and a
 * refusal that will not say which key it means is a refusal a caller cannot act
 * on - "the request does not match this route's schema" against a body of twelve
 * fields is a guessing game. A key name is not a submitted value: it is the
 * caller's own field naming, it is what the caller must change, and it is the one
 * part of the input the schema has already decided it will not store or process.
 * The 182 property therefore narrows from "no submitted input" to "no submitted
 * **value**", and everything else on this page is unchanged - a `z.record` key is
 * still reduced to `*`, because there the key *is* content the schema accepted.
 *
 * Named under bounds, because a key name is attacker-controlled text reflected
 * into a response body and a log line: {@link MAX_KEYS_PER_ISSUE} keys per issue,
 * {@link MAX_KEY_LENGTH} characters each including the truncation marker, control and
 * format characters removed so
 * a caller cannot inject a newline into the log or a zero-width run into the
 * message. With {@link MAX_REPORTED_ISSUES} the whole envelope stays small whatever
 * arrives.
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
 * Cap on unrecognized keys named per issue. Five is enough to fix a hand-written
 * body or a mistyped client; past that the caller is sending a different shape
 * than the route has, and a count says so more usefully than a list would.
 */
const MAX_KEYS_PER_ISSUE = 5;

/**
 * Cap on the length of a named key, in characters, **including the truncation
 * marker**. Far past any field name this API declares, so a real mistake is always
 * shown in full, while a key invented to bloat the response or the log is cut to a
 * fixed size.
 *
 * The marker counts towards the cap rather than riding on top of it, so this number
 * is the whole answer to "how long can a named key get" - the one a caller reads in
 * `docs/api-walkthrough.md` and the one the worst-case envelope arithmetic uses
 * (`MAX_REPORTED_ISSUES` x `MAX_KEYS_PER_ISSUE` x this). A cap that a marker could
 * push past would be a cap a reader has to recompute.
 *
 * Characters here means code points, so a key of astral characters is 64 of them and
 * more than 64 bytes. Still bounded, and bounded by the thing a caller can count.
 */
const MAX_KEY_LENGTH = 64;

/** Marker that replaces the tail of a key cut at {@link MAX_KEY_LENGTH}. */
const TRUNCATION_MARK = "...";

/**
 * Control, format and line-separator characters, removed from a named key. A key
 * reaches the `warn` log line as well as the response body, so a caller must not
 * be able to put a newline, an ANSI escape or a zero-width run inside it. `\p{C}`
 * covers the C0/C1 controls and the format characters; the two separators are the
 * line breaks outside them.
 */
const UNSAFE_IN_KEY = /[\p{C}\p{Zl}\p{Zp}]/gu;

/** Zod's `unrecognized_keys` issue code - the one issue kind that names keys. */
const UNRECOGNIZED_KEYS = "unrecognized_keys";

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
  /**
   * The unknown keys this object refused, sanitized and capped (#893). Present
   * only on an `unrecognized_keys` issue; the names are the caller's own field
   * naming, never a submitted value.
   */
  readonly keys?: readonly string[];
  /** Keys beyond {@link MAX_KEYS_PER_ISSUE}; absent when none were dropped. */
  readonly omittedKeys?: number;
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
 * One refused key, stripped of anything unsafe in a log line and cut to length.
 *
 * Measured and cut in **code points** rather than UTF-16 code units, so a key
 * ending in an astral character is not left with half of a surrogate pair. That is
 * cosmetic rather than a safety property - a lone surrogate survives
 * `JSON.stringify` as an escape and forges nothing - but a refusal that names a key
 * should name something a caller can read, and `[...key]` costs nothing here.
 */
function safeKey(key: unknown): string {
  const scrubbed = [...String(key).replace(UNSAFE_IN_KEY, "")];
  if (scrubbed.length <= MAX_KEY_LENGTH) return scrubbed.join("");
  const kept = scrubbed.slice(0, MAX_KEY_LENGTH - TRUNCATION_MARK.length).join("");
  return `${kept}${TRUNCATION_MARK}`;
}

/**
 * The keys an `unrecognized_keys` issue refused. Zod carries them on the issue as
 * `keys`; read through a local shape because `ZodError`'s issue union narrows by a
 * literal code and this stays readable across a Zod minor.
 */
function refusedKeys(issue: { readonly code: string }): readonly string[] {
  if (issue.code !== UNRECOGNIZED_KEYS) return [];
  const keys = (issue as { readonly keys?: unknown }).keys;
  return Array.isArray(keys) ? keys.map(safeKey) : [];
}

/** The reported form of one Zod issue: its location, its rule, and any refused keys. */
function reportIssue(issue: {
  readonly code: string;
  readonly path: readonly PropertyKey[];
}): ValidationIssueReport {
  const keys = refusedKeys(issue);
  const named = keys.slice(0, MAX_KEYS_PER_ISSUE);
  const omittedKeys = keys.length - named.length;
  return {
    path: safePath(issue.path),
    code: issue.code,
    ...(named.length > 0 ? { keys: named } : {}),
    ...(omittedKeys > 0 ? { omittedKeys } : {}),
  };
}

/** The base message, unchanged for every failure that is not an unknown key. */
const SCHEMA_MISMATCH = "The request does not match this route's schema";

/**
 * The refusal message. An unknown key gets named (#893) so the caller can fix the
 * body; every other failure keeps the location-only message, because there the
 * thing to name would be a value.
 */
function refusalMessage(reports: readonly ValidationIssueReport[]): string {
  const named: string[] = [];
  let dropped = 0;
  for (const report of reports) {
    for (const key of report.keys ?? []) {
      if (named.length < MAX_KEYS_PER_ISSUE) named.push(`"${key}"`);
      else dropped += 1;
    }
    dropped += report.omittedKeys ?? 0;
  }
  if (named.length === 0) return SCHEMA_MISMATCH;
  const noun = named.length === 1 && dropped === 0 ? "key" : "keys";
  const more = dropped > 0 ? ` and ${String(dropped)} more` : "";
  return `${SCHEMA_MISMATCH}: unrecognized ${noun} ${named.join(", ")}${more}`;
}

/**
 * The value-free {@link ApiError} for a failed request-schema validation.
 * Exported for the tests that pin the shape; production code reaches it through
 * {@link validationErrorHook}.
 */
export function invalidRequest(target: keyof ValidationTargets, error: ZodError): ApiError {
  const reported = error.issues.slice(0, MAX_REPORTED_ISSUES).map(reportIssue);
  const omitted = error.issues.length - reported.length;
  const details: ValidationFailureDetails = {
    target,
    issues: reported,
    ...(omitted > 0 ? { omitted } : {}),
  };
  return new ApiError(INVALID_REQUEST, 400, refusalMessage(reported), details);
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
