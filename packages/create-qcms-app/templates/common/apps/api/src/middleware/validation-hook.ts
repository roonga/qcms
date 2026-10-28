/**
 * `@hono/zod-openapi`'s validator returns a 400 echoing submitted values, bypassing
 * `onError`; this `defaultHook` throws instead. A refusal carries locations and issue codes,
 * never values (SEC-8, SEC-13), except an unrecognized key name, which is bounded.
 */

import type { ValidationTargets } from "hono";
import type { ZodError } from "zod";

import { ApiError } from "../errors.js";

export const INVALID_REQUEST = "INVALID_REQUEST";

/** Bounded so a large malformed body cannot turn one refusal into a huge response. */
const MAX_REPORTED_ISSUES = 20;

const ROOT_PATH = "(root)";

const MAX_KEYS_PER_ISSUE = 5;

/**
 * Counted in code points and **including the truncation marker**, so this number is
 * the whole answer to how long a named key can get.
 */
const MAX_KEY_LENGTH = 64;

const TRUNCATION_MARK = "...";

/**
 * A key travels as attacker-controlled text into a body someone else will render,
 * print or grep, so a newline, an ANSI escape or a zero-width run is stripped first.
 */
const UNSAFE_IN_KEY = /[\p{C}\p{Zl}\p{Zp}]/gu;

const UNRECOGNIZED_KEYS = "unrecognized_keys";

/**
 * A `z.record` keys its children by whatever the caller sent, so the shape of a path
 * segment is what decides whether it is reproduced; anything else becomes `*`.
 */
const FIELD_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export interface ValidationIssueReport {
  readonly path: string;
  readonly code: string;
  /** The caller's own field naming, never a submitted value. */
  readonly keys?: readonly string[];
  readonly omittedKeys?: number;
}

export interface ValidationFailureDetails {
  readonly target: keyof ValidationTargets;
  readonly issues: readonly ValidationIssueReport[];
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

/** Cut in code points so a key ending in an astral character keeps both surrogates. */
function safeKey(key: unknown): string {
  const scrubbed = [...String(key).replace(UNSAFE_IN_KEY, "")];
  if (scrubbed.length <= MAX_KEY_LENGTH) return scrubbed.join("");
  const kept = scrubbed.slice(0, MAX_KEY_LENGTH - TRUNCATION_MARK.length).join("");
  return `${kept}${TRUNCATION_MARK}`;
}

/**
 * Read through a local shape because `ZodError`'s issue union narrows by a literal
 * code; this stays readable across a Zod minor.
 */
function refusedKeys(issue: { readonly code: string }): readonly string[] {
  if (issue.code !== UNRECOGNIZED_KEYS) return [];
  const keys = (issue as { readonly keys?: unknown }).keys;
  return Array.isArray(keys) ? keys.map(safeKey) : [];
}

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

const SCHEMA_MISMATCH = "The request does not match this route's schema";

/**
 * Only an unknown key is named; every other failure keeps the location-only message,
 * because there the thing to name would be a submitted value.
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
 * Declared locally because the library's `Hook` type is exported only as part of the
 * route's inferred input; a narrower parameter still satisfies the wider one.
 */
type ValidationOutcome = { readonly target: keyof ValidationTargets } & (
  { readonly success: true } | { readonly success: false; readonly error: ZodError }
);

export function validationErrorHook(result: ValidationOutcome): void {
  if (result.success) return;
  throw invalidRequest(result.target, result.error);
}
