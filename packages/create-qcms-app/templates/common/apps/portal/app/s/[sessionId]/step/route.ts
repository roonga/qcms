import type { A2UIAnswerValue } from "@roonga/qcms-ui";
import { INSTANCE_NAME_SEPARATOR } from "@roonga/qcms-ui/repeat-node";
import { NextResponse } from "next/server";

import { splitFieldKey } from "../../../../lib/repeat";
import { t } from "@/lib/i18n/en";
import { currentBasePath } from "@/lib/server/environment";
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
 * The no-JS whole-step form POST.
 *
 * Strict BFF (R2): the API validates every answer, decides visibility, and owns the
 * ready-to-submit and honeypot checks. `decodeStepForm` is pure transport, driven by
 * the renderer's kind tags rather than by any question knowledge.
 */

/**
 * Prefixed (Q21): `proxy.ts` rewrote this request's path, so `request.url` carries the
 * unprefixed form and an unprefixed redirect would send a non-prod respondent to
 * `prod`'s address, where their session does not exist.
 */
async function backToStep(request: Request, sessionId: string): Promise<NextResponse> {
  const basePath = await currentBasePath();
  return NextResponse.redirect(new URL(`${basePath}/s/${sessionId}`, request.url), 303);
}

// Omitting `step` serves the first incomplete step, which is what a blocked Submit
// needs (ADR-28).
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

interface Forwarded {
  readonly values: Record<string, A2UIAnswerValue>;
  readonly errors: Record<string, string>;
  readonly constraints: Record<string, string>;
  readonly last: StepResponse | undefined;
  readonly fatal: boolean;
}

/**
 * `QUESTION_NOT_VISIBLE` is not a failure: a whole-step post carries fields rendered
 * before this round's own answers changed a branch, so a field this round hid is
 * dropped, including a clear for it.
 */
function recordBatchRejection(
  rejection: BatchRejection,
  errors: Record<string, string>,
  constraints: Record<string, string>,
): void {
  if (rejection.code === "QUESTION_NOT_VISIBLE") return;
  const field = fieldKey(rejection.questionId, rejection.instanceId);
  errors[field] = defaultAnswerMessage(
    firstAnswerRejection(rejection.details),
    t("answer.invalid"),
  );
  const constraint = firstAnswerRejection(rejection.details)?.constraint;
  if (constraint !== undefined) constraints[field] = constraint;
}

/**
 * A count refusal (ADR-42) is the one sweep entry with no field to report against, so
 * it becomes a page-level notice. The shape is read rather than trusted, because
 * `details` crosses the BFF boundary as `unknown`.
 */
function isCountRefusal(details: unknown): boolean {
  if (typeof details !== "object" || details === null) return false;
  const errors = (details as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { code?: unknown }).code === "REPEAT_COUNT_OUT_OF_RANGE",
  );
}

function fieldKey(questionId: string, instanceId?: string): string {
  return instanceId === undefined
    ? questionId
    : `${instanceId}${INSTANCE_NAME_SEPARATOR}${questionId}`;
}

/**
 * The batch endpoint (ADR-43) rather than one call per answer: one request, one session
 * lock, one flow evaluation, which is what makes a repeating group's Continue affordable.
 *
 * A decoded `null` is a retraction rather than a value. The rate limit is per entry, not
 * per request (SEC-16), so a 429 means nothing was applied.
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
    // A retraction is not recorded as a re-render value: leaving the key absent lets
    // the now-empty stored answer show through and the field renders blank.
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
    // A refusal of the whole request wrote nothing, so the caller re-renders the step
    // with what the respondent typed.
    return { values, errors, constraints, last: undefined, fatal: true };
  }
}

/**
 * Nothing about `required` is decided here: `missingRequired` is the kernel's, and this
 * narrows it twice. To the posted fields, because the set is flow-wide and would
 * otherwise accuse a respondent of a gap on a step they have not been shown. And around
 * a 422, which is missing an answer by construction but already carries a better message.
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
 * Returns the absence rather than throwing: a failed read costs the round its
 * missing-required report and its readiness verdict, but the refusals and the values
 * the respondent typed are written regardless.
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
  // SEC-9's CSRF belt. The refusal is a 303 back to the flow page, as every other
  // unusable request on this route gets: the respondent sees their step, not a code.
  if (!isSameOriginPost(request)) return await backToStep(request, sessionId);

  const token = await readSessionToken();
  if (token === undefined) {
    return await backToStep(request, sessionId);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return await backToStep(request, sessionId);
  }
  const { answers, extras, fields } = decodeStepForm(form);
  const { values, errors, constraints, last, fatal } = await forwardAnswers(
    sessionId,
    token,
    answers,
  );

  if (fatal) {
    // Nothing was written, so the typed values are carried into the re-render, with a
    // notice: a step that re-renders unchanged and says nothing is a silent dead end.
    await writeStepContext({
      values,
      errors: {},
      constraints: {},
      missingRequired: [],
      notice: "step.notSaved",
    });
    return await backToStep(request, sessionId);
  }

  // `missingRequired` and `readyToSubmit` are the API's, never recomputed here (R2).
  const projection = last ?? (await projectionOrNone(sessionId, token));
  const missingRequired =
    projection === undefined
      ? []
      : missingOnPostedStep(projection.flowState.missingRequired, fields, errors);

  // The re-render context is written on every path back to the step, including the one
  // where the projection could not be read: only the missing-required half depends on
  // that read, and with no projection there is nothing to judge readiness from, so the
  // round ends here rather than submitting on a guess.
  if (
    projection === undefined ||
    Object.keys(errors).length > 0 ||
    missingRequired.length > 0 ||
    !projection.flowState.readyToSubmit
  ) {
    const context: StepContext = { values, errors, constraints, missingRequired };
    await writeStepContext(context);
    return await backToStep(request, sessionId);
  }

  try {
    const receipt = await submitSession(sessionId, token, extras);
    await writeReceiptCookie(receipt);
    await clearSessionToken();
    return NextResponse.redirect(new URL(`${await currentBasePath()}/done`, request.url), 303);
  } catch (error) {
    // A count refusal has no field to hang a message on, so it needs the page-level
    // notice or the press returns the same step in silence. The notice rides as a
    // catalogue key, so a cookie from an earlier build cannot render a blank banner.
    if (error instanceof ApiError && isCountRefusal(error.details)) {
      await writeStepContext({
        values,
        errors: {},
        constraints: {},
        missingRequired: [],
        notice: "step.countOutOfRange",
      });
    }
    return await backToStep(request, sessionId);
  }
}
