import { ApiError } from "../../errors.js";

const STORED_STAMP = /^\d+$/;

/** Refusal messages name no snapshot content (SEC-8). */
export function unsupportedSemanticsVersion(): ApiError {
  return new ApiError(
    "UNSUPPORTED_SEMANTICS_VERSION",
    409,
    "This form version records evaluation semantics this release does not implement",
  );
}

/** Strict so an unreadable stamp refuses rather than reaching the evaluator as `NaN`. */
export function parseSemanticsVersion(stored: string): number {
  if (!STORED_STAMP.test(stored)) throw unsupportedSemanticsVersion();
  return Number(stored);
}
