import type { A2UIAnswerValue } from "@roonga/qcms-ui";
import { INSTANCE_NAME_SEPARATOR } from "@roonga/qcms-ui/repeat-node";
import { NextResponse } from "next/server";

import { splitFieldKey } from "../../../../lib/repeat";
import { t } from "@/lib/i18n/en";
import {
  ApiError,
  batchAnswers,
  getStep,
  submitSession,
  type BatchRejection,
  type StepResponse,
} from "@/lib/server/api";
import {
  apiErrorResponse,
  isSameOriginPost,
  writeReceiptCookie,
  writeStepContext,
  type StepContext,
} from "@/lib/server/route-helpers";
import { clearSessionToken, readSessionToken } from "@/lib/server/session-cookie";
import { decodeStepForm } from "@/lib/server/step-form";
import { defaultAnswerMessage, firstAnswerRejection } from "@/lib/validation-message";

/**
 * BFF proxy: the no-JS whole-step form POST (task 044). A JavaScript-disabled
 * respondent submits the native `<form method="post">` the @roonga/qcms-ui renderer
 * emits in native-submit mode; this route decodes the form-encoded fields to
 * canonical answers, forwards each to the internal API's per-question endpoint
 * (the SAME endpoint the JS path uses), and - once the API says the flow is ready
 * - submits the session and redirects to the completion page. Every step is a
 * fresh page load (classic post/redirect/get), so branching re-renders naturally.
 *
 * Strict BFF (R2): this handler does proxy + session/credential duty ONLY. It
 * performs NO validation authority and NO rule evaluation - the API validates
 * every answer, decides visibility, and owns the ready-to-submit and honeypot
 * checks. The decode step (`decodeStepForm`) is pure transport (form strings ->
 * canonical JSON), driven by the renderer's kind tags, not by any question
 * knowledge. It imports nothing from `@roonga/qcms-core` (enforced by the R2
 * import-surface test); `StepResponse` and `A2UIAnswerValue` are type-only.
 *
 * The honeypot decoy (026) rides in the form with no kind tag, so it lands in the
 * decoded `extras` and is forwarded verbatim into the session-submit body, where
 * the API's anti-abuse check reads it - exactly as on the JS path.
 *
 * A required question left blank is reported rather than silently reloaded (issue
 * #920). The API already refuses to store an empty answer and refuses to submit a
 * session with a required gap; what was missing was the respondent being told on
 * this transport. `missingOnPostedStep` carries the reasoning - it reads the API's
 * own `flowState.missingRequired` and decides nothing.
 *
 * Clearing works here too (issue #127). A field the renderer marked as holding an
 * answer, arriving empty, decodes to `null`, and `forwardAnswers` posts that to the
 * same `/answers` endpoint the scripted path posts its clears to, so it becomes the
 * same ADR-33 tombstone. It is not a special case in this handler: a retraction is
 * one more decoded answer, subject to the same authorization, visibility and error
 * handling as every other.
 */

/** Redirect (303) back to the flow page so the server re-renders the step. */
function backToStep(request: Request, sessionId: string): NextResponse {
  return NextResponse.redirect(new URL(`/s/${sessionId}`, request.url), 303);
}

/**
 * BFF proxy: fetch one step's document + flow projection for the JS navigation
 * cursor (ADR-28, task 045). The controlled `StepFlow` calls
 * `GET /s/:id/step?step=<index>` on Continue/Back; the BFF attaches the session
 * bearer from the httpOnly cookie and forwards the cursor to the internal API,
 * returning its projection verbatim. Omitting `step` serves the first incomplete
 * step (used when a blocked Submit sends the respondent to the step that still
 * needs an answer). No rule evaluation happens here (R2) - the API owns it.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const token = await readSessionToken();
  if (token === undefined) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const { sessionId } = await ctx.params;
  const raw = new URL(request.url).searchParams.get("step");
  let stepIndex: number | undefined;
  if (raw !== null) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return NextResponse.json({ error: { code: "bad_request" } }, { status: 400 });
    }
    stepIndex = parsed;
  }
  try {
    const next = await getStep(sessionId, token, stepIndex);
    return NextResponse.json(next);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** The outcome of forwarding a step's decoded answers to the API. */
interface Forwarded {
  /** Submitted values, kept so a re-render re-populates the form. */
  readonly values: Record<string, A2UIAnswerValue>;
  /** Per-field typed validation errors (422s), for the error slots. */
  readonly errors: Record<string, string>;
  /** Which constraint each 422 named, so the re-render can pick the author's wording. */
  readonly constraints: Record<string, string>;
  /** The projection the API returned for the batch (its `readyToSubmit` is authoritative). */
  readonly last: StepResponse | undefined;
  /** A non-recoverable API error (session lost/expired/5xx): re-render the page. */
  readonly fatal: boolean;
}

/**
 * Record one refused batch entry against the field it names.
 *
 * The API returns a refusal per entry rather than failing the request, so this is the
 * same three-outcome classification the per-answer loop had, minus the third: a 422 is
 * the respondent's to fix and fills that field's error slot (WCAG 3.3), and
 * `QUESTION_NOT_VISIBLE` is not a failure at all - a whole-step post carries fields
 * rendered before this round's own answers changed a branch, so a field this round just
 * hid is silently dropped, including a clear for it (issue #127). A fatal error is now
 * a failed REQUEST rather than a failed entry, which is what the `catch` around the
 * call handles.
 */
function recordBatchRejection(
  rejection: BatchRejection,
  errors: Record<string, string>,
  constraints: Record<string, string>,
): void {
  if (rejection.code === "QUESTION_NOT_VISIBLE") return;
  // The answer key, which is the field's whole identity below the API: a bare
  // questionId outside a repeating group and `instanceId/questionId` inside one. It is
  // the string the error slot, the summary anchor and the field's own id all use.
  const field = fieldKey(rejection.questionId, rejection.instanceId);
  errors[field] = defaultAnswerMessage(
    firstAnswerRejection(rejection.details),
    t("answer.invalid"),
  );
  const constraint = firstAnswerRejection(rejection.details)?.constraint;
  if (constraint !== undefined) constraints[field] = constraint;
}

/** `ins_7k2/q_plate`, or the bare question id outside every group (ADR-42, Q15). */
function fieldKey(questionId: string, instanceId?: string): string {
  return instanceId === undefined
    ? questionId
    : `${instanceId}${INSTANCE_NAME_SEPARATOR}${questionId}`;
}

/**
 * Forward a step's decoded answers to the API's **batch** endpoint (task 073, Q20,
 * ADR-43): one request, one session lock, one flow evaluation.
 *
 * **Why it changed.** This used to make one `POST /sessions/{id}/answers` per decoded
 * answer, sequentially, each taking the session's advisory lock and re-evaluating the
 * whole flow. That was fine for a step of six questions and is not fine for a repeating
 * group: nine passengers times six questions is fifty-four round trips and fifty-four
 * advisory locks for one Continue. The batch is the same answers, the same validation,
 * the same authority (R2 - the API is still the sole validator) and one call.
 *
 * A decoded `null` is a RETRACTION rather than a value (issue #127): the field was
 * marked as holding an answer and arrived empty, so the respondent cleared it. It rides
 * the batch as `value: null`, the same body the scripted path posts for the same
 * gesture, so both transports still reach one ledger semantics.
 *
 * **The rate limit is per entry, not per request** (SEC-16), so a 429 here means the
 * batch did not fit the window's remaining allowance and **nothing was applied** - the
 * caller re-renders with the values the respondent typed and no answer written.
 */
async function forwardAnswers(
  sessionId: string,
  token: string,
  answers: readonly { questionId: string; value: unknown }[],
): Promise<Forwarded> {
  const values: Record<string, A2UIAnswerValue> = {};
  const errors: Record<string, string> = {};
  const constraints: Record<string, string> = {};
  for (const answer of answers) {
    // A retraction is deliberately NOT recorded as a re-render value. The cookie
    // exists to re-show what the API does not hold; here the API holds nothing
    // precisely because this call succeeded, so leaving the key ABSENT lets the
    // (now empty) stored answer show through and the field renders blank. Writing
    // it would also have to survive JSON, where an `undefined` member vanishes -
    // see `mergeStepValues` on why absent and cleared are different renders.
    if (answer.value !== null) values[answer.questionId] = answer.value as A2UIAnswerValue;
  }
  if (answers.length === 0) return { values, errors, constraints, last: undefined, fatal: false };
  try {
    const result = await batchAnswers(
      sessionId,
      token,
      answers.map((answer) => ({ ...splitFieldKey(answer.questionId), value: answer.value })),
    );
    for (const rejection of result.rejected) {
      recordBatchRejection(rejection, errors, constraints);
    }
    return { values, errors, constraints, last: result, fatal: false };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // Every refusal of the whole REQUEST is fatal to this round: a lost or expired
    // session, a 5xx, or a 429 for a batch that did not fit the window. None of them
    // wrote anything, so the caller re-renders the step with what the respondent typed.
    return { values, errors, constraints, last: undefined, fatal: true };
  }
}

/**
 * The questions this post left without a required answer: the API's own
 * missing-required set, narrowed to the fields the posted form actually asked
 * (issue #920).
 *
 * ## What is and is not decided here
 *
 * Nothing about `required` is decided here. `missingRequired` is the kernel's
 * (`evaluateRules`, invariant I9), served on every projection, and the hydrated
 * `StepFlow` has always gated Continue and Submit on it. This is the same read for
 * the other transport: the no-JS round trip has no client state to carry the gate,
 * so the set travels in the re-render context instead and the step re-renders with
 * the messages beside the fields. The API refuses the submit either way - a
 * respondent who defeats the browser's `required` still gets `MISSING_REQUIRED`
 * from the submission sweep - so what changes is whether they are told, not whether
 * an empty required answer can be stored (it never could: the answer endpoint
 * refuses `""` and `[]` outright as `EMPTY_ANSWER_NOT_ALLOWED`).
 *
 * ## The two narrowings
 *
 * - **To this step.** `missingRequired` is flow-wide and cursor-independent, so
 *   unfiltered it would also name required questions on steps ahead - reported
 *   before the respondent has been shown them. The posted form's own kind tags say
 *   which questions were on the page, which is a fact about the post rather than a
 *   visibility judgement (`decodeStepForm`). A question a just-changed branch has
 *   only now revealed was not on the posted form, so it is not reported either: the
 *   respondent sees it appear, unanswered and unaccused.
 * - **Around a refusal.** A question the API refused with a 422 is also missing an
 *   answer, by construction. It already carries the kernel's own message, which
 *   says more than "this needs an answer", so it keeps it.
 */
function missingOnPostedStep(
  missingRequired: readonly string[],
  fields: readonly string[],
  errors: Readonly<Record<string, string>>,
): readonly string[] {
  const posted = new Set(fields);
  return missingRequired.filter((questionId) => {
    return posted.has(questionId) && !Object.hasOwn(errors, questionId);
  });
}

/**
 * One fresh step read, or `undefined` when the API could not be reached.
 *
 * A failure is deliberately NOT fatal to the caller. It costs the round its
 * missing-required report and its readiness verdict, both of which are the API's to
 * give, and it costs the respondent nothing else: the refusals and the values they
 * typed are already in hand and are written regardless. Returning the absence rather
 * than throwing is what lets the caller keep those two facts apart.
 */
async function projectionOrNone(
  sessionId: string,
  token: string,
): Promise<StepResponse | undefined> {
  try {
    return await getStep(sessionId, token);
  } catch {
    return undefined;
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const { sessionId } = await ctx.params;
  // SEC-9's CSRF belt (issue #487). This is the no-JS whole-step POST, so the
  // refusal is the same 303 back to the flow page every other unusable request on
  // this route gets: the respondent sees their step, not an error code.
  if (!isSameOriginPost(request)) return backToStep(request, sessionId);

  const token = await readSessionToken();
  if (token === undefined) {
    // No session credential: let the flow page render its recovery state.
    return backToStep(request, sessionId);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return backToStep(request, sessionId);
  }
  const { answers, extras, fields } = decodeStepForm(form);
  const { values, errors, constraints, last, fatal } = await forwardAnswers(
    sessionId,
    token,
    answers,
  );

  if (fatal) {
    // The batch request itself was refused: a lost or expired session, a 5xx, or a 429
    // for a batch that did not fit the window's remaining allowance (SEC-16). None of
    // them wrote anything, and the values the respondent typed do not depend on the
    // API having accepted them, so they are carried into the re-render rather than
    // dropped to a transient failure - which is the silent reload issue #920 exists to
    // remove, met here from the other side.
    // With a NOTICE, which is the half this used to be missing (ruling Q29, 2026-10-02).
    // The values come back either way, but a step that re-renders unchanged and says
    // nothing is the silent reload issue #920 removed from the required-answer path: a
    // respondent whose batch was refused by the rate limiter saw their own answers and no
    // reason, and pressing Continue again produced the same silence.
    await writeStepContext({
      values,
      errors: {},
      constraints: {},
      missingRequired: [],
      notice: "step.notSaved",
    });
    return backToStep(request, sessionId);
  }

  // The authoritative projection: the one the API returned for the last answer
  // written, or a fresh read when this round wrote none (every field blank, or every
  // answer refused). Its `missingRequired` and `readyToSubmit` are the API's, never
  // recomputed here (R2).
  const projection = last ?? (await projectionOrNone(sessionId, token));
  const missingRequired =
    projection === undefined
      ? []
      : missingOnPostedStep(projection.flowState.missingRequired, fields, errors);

  // Write the re-render context on EVERY path that returns the respondent to the
  // step, including the one where the projection could not be read. The refusals and
  // the values the respondent typed do not depend on that read - only the
  // missing-required half does - and dropping them to a transient read failure is the
  // silent reload this route exists to remove (reviewer finding, issue #920). Without
  // a projection there is also nothing to judge readiness from, so the round ends
  // here rather than submitting on a guess.
  if (
    projection === undefined ||
    Object.keys(errors).length > 0 ||
    missingRequired.length > 0 ||
    !projection.flowState.readyToSubmit
  ) {
    const context: StepContext = { values, errors, constraints, missingRequired };
    await writeStepContext(context);
    return backToStep(request, sessionId);
  }

  try {
    const receipt = await submitSession(sessionId, token, extras);
    await writeReceiptCookie(receipt);
    await clearSessionToken();
    return NextResponse.redirect(new URL("/done", request.url), 303);
  } catch {
    // A submit that fails the API's final sweep (e.g. a missing required answer)
    // returns the respondent to the step to complete it.
    return backToStep(request, sessionId);
  }
}
