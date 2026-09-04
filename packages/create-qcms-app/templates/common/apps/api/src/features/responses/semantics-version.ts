/**
 * The stored evaluation-semantics stamp (ADR-16, issue #723).
 *
 * `form_versions.semantics_version` is a text column: publish writes
 * `String(SEMANTICS_VERSION)` for the semantics the snapshot was validated
 * under, and every reader that hands a snapshot to the kernel has to turn that
 * text back into the number the evaluator gates on (I7).
 *
 * `Number()` was doing that job at the submit call site, and `Number()` maps an
 * unreadable stamp to `NaN`, which compares unequal to every semantics version.
 * A corrupt row therefore looked exactly like the legitimate "old snapshot,
 * superseded semantics" case, so a data-integrity break disappeared into a
 * refusal naming the wrong cause. The parse is strict instead: a stamp that is
 * not a decimal integer is refused at the read, under the same typed envelope
 * code an unsupported version gets.
 *
 * Both refusals are client-safe and name no snapshot content (SEC-8).
 */

import { ApiError } from "../../errors.js";

/** The stamp as publish writes it (`String(SEMANTICS_VERSION)`): a decimal integer. */
const STORED_STAMP = /^\d+$/;

/**
 * The typed refusal for a snapshot this release cannot evaluate (ADR-16):
 * either the stored semantics are superseded, or the stamp itself is
 * unreadable. 409, because the stored state conflicts with what this build
 * implements - a retry against the same deployment gets the same answer.
 */
export function unsupportedSemanticsVersion(): ApiError {
  return new ApiError(
    "UNSUPPORTED_SEMANTICS_VERSION",
    409,
    "This form version records evaluation semantics this release does not implement",
  );
}

/**
 * Read a stored stamp as the number the kernel gates on. Throws the typed
 * refusal when the text is not a decimal integer, so the value handed to the
 * evaluator is never `NaN`.
 */
export function parseSemanticsVersion(stored: string): number {
  if (!STORED_STAMP.test(stored)) throw unsupportedSemanticsVersion();
  return Number(stored);
}
