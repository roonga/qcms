/**
 * What the hydrated flow does with a response that is not the success it asked for, and
 * when a failure notice it is showing stops being true.
 */

const PAGE_OWNED_CODES: ReadonlySet<string> = new Set([
  "SESSION_EXPIRED",
  "SESSION_SUBMITTED",
  "UNSUPPORTED_SEMANTICS_VERSION",
  "SESSION_NOT_FOUND",
]);

/**
 * `notVisible` means the API refused a field the current projection does not show, which
 * a re-read of the step resolves.
 *
 * `code` is read once by the caller, because a `Response` body can be consumed only
 * once and two predicates that each read it left the second one reading nothing.
 */
export type RefusalOutcome = "reload" | "notVisible" | "failed";

export function refusalOutcome(status: number, code: string | undefined): RefusalOutcome {
  if (status === 401) return "reload";
  if (code === undefined) return "failed";
  if ((status === 409 || status === 404) && PAGE_OWNED_CODES.has(code)) return "reload";
  if (status === 409 && code === "QUESTION_NOT_VISIBLE") return "notVisible";
  return "failed";
}

/** Also what the notice's Try again control re-runs. */
export type FlowFailure =
  | { readonly kind: "answer"; readonly questionId: string }
  | { readonly kind: "advance" }
  | { readonly kind: "back" }
  | { readonly kind: "refresh" };

export type FlowSuccess =
  | { readonly kind: "answer"; readonly questionId: string }
  | { readonly kind: "navigation" }
  | { readonly kind: "roster" }
  | { readonly kind: "submitRefused" };

export function failureAfterSuccess(
  failure: FlowFailure | undefined,
  success: FlowSuccess,
): FlowFailure | undefined {
  if (failure === undefined) return undefined;
  if (success.kind === "navigation") return undefined;
  if (failure.kind !== "answer") return undefined;
  if (success.kind === "answer" && success.questionId === failure.questionId) return undefined;
  return failure;
}

/**
 * A count refusal (ADR-42) describes the roster as it was when Submit was pressed, so an
 * Add, a Remove or a navigation makes it stale. An answer post leaves it standing: no
 * answer changes a group's count.
 */
export function countRefusalAfterSuccess(refused: boolean, success: FlowSuccess): boolean {
  if (!refused) return false;
  return success.kind === "answer";
}
