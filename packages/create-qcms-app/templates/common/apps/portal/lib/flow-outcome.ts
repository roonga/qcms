/**
 * What the hydrated flow does with a response that is not the success it asked for,
 * and when a failure notice it is showing stops being true.
 *
 * Both are decision rules rather than rendering, and both were wrong in ways the
 * screen showed only as a sentence that never went away, so they live here as pure
 * functions `flow-outcome.test.ts` can drive: `components/step-flow.tsx` calls them at
 * every call site that reads a refusal (an answer post, a step read, a submit).
 */

/**
 * The refusal codes whose screen the flow PAGE already owns (`app/s/[sessionId]/page.tsx`,
 * `ReadFailure`), so the hydrated flow answers them by reloading that page rather than by
 * painting a sentence of its own.
 *
 * - `SESSION_EXPIRED` and `SESSION_SUBMITTED` are the API's 409s for a session that can
 *   no longer take an answer (`apps/api/src/features/responses/serve-step/handler.ts`).
 *   They used to fall through to the inline "We could not reach the server" notice,
 *   which is untrue and invites a retry that gets the same 409 for ever.
 * - `UNSUPPORTED_SEMANTICS_VERSION` is ADR-16's refusal (issue #743), terminal for the
 *   same reason.
 * - `SESSION_NOT_FOUND` is the 404 the page answers with its recovery screen.
 *
 * Read by CODE and not by status alone, because 409 is also how a post of a question
 * the projection has just hidden is refused, and that one is not terminal.
 */
const PAGE_OWNED_CODES: ReadonlySet<string> = new Set([
  "SESSION_EXPIRED",
  "SESSION_SUBMITTED",
  "UNSUPPORTED_SEMANTICS_VERSION",
  "SESSION_NOT_FOUND",
]);

/**
 * How the flow answers a refused request:
 *
 * - `reload`: the page owns the screen for it (a lost credential, an expired or
 *   submitted session, the semantics refusal), so re-read the page and let it say what
 *   happened;
 * - `notVisible`: the API refused a field the current projection does not show (issue
 *   #1041), which a re-read of the step resolves;
 * - `failed`: anything else, which is the inline "could not reach the server" notice.
 *
 * `code` is the typed error code out of the BFF body (`errorCodeOf`), read ONCE by the
 * caller. Reading the body once matters: a `Response` body can be consumed only once,
 * and two predicates that each read it left the second one reading nothing.
 */
export type RefusalOutcome = "reload" | "notVisible" | "failed";

export function refusalOutcome(status: number, code: string | undefined): RefusalOutcome {
  if (status === 401) return "reload";
  if (code === undefined) return "failed";
  if ((status === 409 || status === 404) && PAGE_OWNED_CODES.has(code)) return "reload";
  if (status === 409 && code === "QUESTION_NOT_VISIBLE") return "notVisible";
  return "failed";
}

/**
 * The operation a "could not reach the server" notice is about, which is also what its
 * Try again control re-runs.
 *
 * - `answer`: an answer post for one question (re-committed from the value on screen);
 * - `advance`: a Continue or Submit;
 * - `back`: a Back;
 * - `refresh`: the step re-read a not-visible refusal asked for.
 */
export type FlowFailure =
  | { readonly kind: "answer"; readonly questionId: string }
  | { readonly kind: "advance" }
  | { readonly kind: "back" }
  | { readonly kind: "refresh" };

/** A round trip the server answered, which may make a showing failure notice stale. */
export type FlowSuccess =
  | { readonly kind: "answer"; readonly questionId: string }
  | { readonly kind: "navigation" }
  | { readonly kind: "roster" }
  | { readonly kind: "submitRefused" };

/**
 * The failure notice still worth showing after a round trip the server answered.
 *
 * A notice that is never cleared outlives the condition it describes: the respondent
 * keeps reading "We could not reach the server" under a page that has since saved three
 * answers. So any answered round trip clears it, with one exception: a failed ANSWER
 * post is cleared only by an answer post for the same question, or by a navigation.
 * Another question's save succeeding says the server is reachable, but not that this
 * answer reached it, and clearing the notice there would take away the one Try again
 * that re-sends it.
 *
 * A navigation clears every notice, because the step it lands on is the server's own
 * word on what is held (the answers are re-merged from it), and an answer failure from
 * the step the respondent has left has no field on screen to be about.
 */
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
 * Whether a page-level count refusal (`REPEAT_COUNT_OUT_OF_RANGE`, ADR-42) is still
 * true after a round trip the server answered.
 *
 * It describes the roster as it was when Submit was pressed, so an Add or Remove makes
 * it stale (the respondent did what it asked, or changed the group again), and so does a
 * navigation, which leaves the page the refusal was about. An answer post leaves it
 * standing: no answer changes a group's count.
 */
export function countRefusalAfterSuccess(refused: boolean, success: FlowSuccess): boolean {
  if (!refused) return false;
  return success.kind === "answer";
}
