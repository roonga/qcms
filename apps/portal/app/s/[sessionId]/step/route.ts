import type { A2UIAnswerValue } from "@qcms/ui";
import { NextResponse } from "next/server";

import { t } from "@/lib/i18n/en";
import {
  ApiError,
  getStep,
  submitAnswer,
  submitSession,
  type StepResponse,
} from "@/lib/server/api";
import {
  apiErrorResponse,
  writeReceiptCookie,
  writeStepContext,
  type StepContext,
} from "@/lib/server/route-helpers";
import { clearSessionToken, readSessionToken } from "@/lib/server/session-cookie";
import { decodeStepForm } from "@/lib/server/step-form";

/**
 * BFF proxy: the no-JS whole-step form POST (task 044). A JavaScript-disabled
 * respondent submits the native `<form method="post">` the @qcms/ui renderer
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
 * knowledge. It imports nothing from `@qcms/core` (enforced by the R2
 * import-surface test); `StepResponse` and `A2UIAnswerValue` are type-only.
 *
 * The honeypot decoy (026) rides in the form with no kind tag, so it lands in the
 * decoded `extras` and is forwarded verbatim into the session-submit body, where
 * the API's anti-abuse check reads it - exactly as on the JS path.
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

/** The API's typed 422 detail, surfaced in the field's error slot (WCAG 3.3). */
function answerErrorMessage(error: ApiError): string {
  const detail = error.details as { errors?: { message?: unknown }[] } | undefined;
  const message = detail?.errors?.[0]?.message;
  return typeof message === "string" && message !== "" ? message : t("answer.invalid");
}

/** The outcome of forwarding a step's decoded answers to the API. */
interface Forwarded {
  /** Submitted values, kept so a re-render re-populates the form. */
  readonly values: Record<string, A2UIAnswerValue>;
  /** Per-question typed validation errors (422s), for the error slots. */
  readonly errors: Record<string, string>;
  /** The last projection the API returned (its `readyToSubmit` is authoritative). */
  readonly last: StepResponse | undefined;
  /** A non-recoverable API error (session lost/expired/5xx): re-render the page. */
  readonly fatal: boolean;
}

/**
 * Forward each decoded answer to the API's per-question endpoint (the sole
 * validator, R2). Collects submitted values and typed 422 errors; skips a
 * question hidden by a just-changed branch trigger; stops on any other API error.
 */
async function forwardAnswers(
  sessionId: string,
  token: string,
  answers: readonly { questionId: string; value: unknown }[],
): Promise<Forwarded> {
  const values: Record<string, A2UIAnswerValue> = {};
  const errors: Record<string, string> = {};
  let last: StepResponse | undefined;
  for (const answer of answers) {
    values[answer.questionId] = answer.value as A2UIAnswerValue;
    try {
      last = await submitAnswer(sessionId, token, answer.questionId, answer.value);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 422) {
        errors[answer.questionId] = answerErrorMessage(error);
      } else if (error.code !== "QUESTION_NOT_VISIBLE") {
        return { values, errors, last, fatal: true };
      }
    }
  }
  return { values, errors, last, fatal: false };
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const token = await readSessionToken();
  const { sessionId } = await ctx.params;
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
  const { answers, extras } = decodeStepForm(form);
  const { values, errors, last, fatal } = await forwardAnswers(sessionId, token, answers);

  if (fatal) return backToStep(request, sessionId);
  if (Object.keys(errors).length > 0) {
    const context: StepContext = { values, errors };
    await writeStepContext(context);
    return backToStep(request, sessionId);
  }

  // Authoritative readiness comes from the API's last projection (or a fresh read
  // when nothing was posted this round). The BFF never computes it (R2).
  let ready = last?.flowState.readyToSubmit;
  if (ready === undefined) {
    try {
      ready = (await getStep(sessionId, token)).flowState.readyToSubmit;
    } catch {
      return backToStep(request, sessionId);
    }
  }

  if (!ready) {
    // More questions are now visible: carry the values so the reload keeps them.
    await writeStepContext({ values, errors: {} });
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
