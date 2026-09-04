import { A2UIStepRenderer } from "@roonga/qcms-ui";
import type { A2UIErrors, A2UIStepDocument, A2UIValues } from "@roonga/qcms-ui";

import { PortalShell } from "@/components/portal-shell";
import { errorSummaryEntries } from "@/lib/error-summary";
import { t } from "@/lib/i18n/en";
import { mergeStepValues } from "@/lib/step-values";
import { buttonClass } from "@/lib/ui";
import { authorMessageFor } from "@/lib/validation-message";
import { documentForVisible, messagesOf } from "@/lib/visible";
import type { StepContext } from "@/lib/server/route-helpers";
import type { StepResponse } from "@/lib/server/api";

/**
 * The no-JS step view (task 044): the progressive-enhancement fallback the SSR
 * paints when JavaScript is unavailable. It renders the current step inside the
 * @roonga/qcms-ui renderer's opt-in native-submit mode - a real
 * `<form method="post" action="/s/:id/step">` with natively-serializing controls
 * and a real submit control - so a respondent with JS disabled can complete and
 * submit the form, one page reload per POST.
 *
 * When JS runs, `ProgressiveStep` swaps this for the existing controlled
 * `StepFlow` (029/030) after hydration, so there is exactly one form live at a
 * time and no double-submit. This component owns no fetch and no rule logic; the
 * whole-step BFF route and the API do all the work.
 *
 * `StepResponse` / `StepContext` are imported type-only, so no server module
 * reaches the client bundle (the R2 import-surface test enforces this).
 */

/**
 * The per-field messages to display: the author's message for the constraint the
 * API refused each answer on, else the default the BFF route already resolved.
 */
function authoredErrors(
  stepDocument: A2UIStepDocument | null,
  context: StepContext | undefined,
): A2UIErrors {
  const errors = context?.errors ?? {};
  const constraints = context?.constraints ?? {};
  if (Object.keys(errors).length === 0) return errors;
  const messages = messagesOf(stepDocument);
  const resolved: Record<string, string> = {};
  for (const [questionId, fallback] of Object.entries(errors)) {
    const authored = authorMessageFor(messages.get(questionId), constraints[questionId]);
    resolved[questionId] = authored ?? fallback;
  }
  return resolved;
}

export function NativeStep({
  sessionId,
  initial,
  context,
}: {
  readonly sessionId: string;
  readonly initial: StepResponse;
  readonly context?: StepContext | undefined;
}) {
  const action = `/s/${encodeURIComponent(sessionId)}/step`;
  const readyToSubmit = initial.flowState.readyToSubmit;
  const submitLabel = readyToSubmit ? t("action.submit") : t("action.continue");
  const progress = {
    current: initial.progress.stepIndex + 1,
    total: initial.progress.totalVisibleSteps,
  };

  const stepDocument = initial.step as unknown as A2UIStepDocument | null;
  // The author's wording wins over the default the BFF resolved, per constraint
  // (task 048, ADR-32). The route carries the CONSTRAINT rather than the final
  // string because only this render holds the compiled document the messages ride
  // on. A question the author left alone keeps the message the route produced.
  const errors: A2UIErrors = authoredErrors(stepDocument, context);
  // The answers the API holds for this step (issue #146) under the just-submitted
  // ones from the no-JS re-render cookie. The cookie has to win, including when it
  // CLEARS a field: see `mergeStepValues`, which owns that three-way behaviour and
  // is tested for it (issue #327).
  const values: A2UIValues = mergeStepValues(initial.values, context?.values);
  // The summary entries, composed by the module both portal paths share
  // (`lib/error-summary.ts`): each entry names its own question by label, or by
  // its position among this step's visible questions when the document carried no
  // label, so no two links can have the same accessible name (WCAG 3.3.1, issues
  // #21 and #326). This path once emitted the bare per-field message for a
  // label-less question, which two questions sharing one author message (ADR-32)
  // could collide on.
  const errorEntries = errorSummaryEntries(
    stepDocument,
    errors,
    initial.flowState.visibleQuestions,
  );

  return (
    <PortalShell progress={progress}>
      <div className="flex flex-col gap-6">
        {errorEntries.length > 0 ? (
          <div
            role="alert"
            aria-labelledby="error-summary-title"
            data-testid="error-summary"
            className="rounded-(--radius-card) border border-(--color-danger) bg-(--color-danger-subtle) p-4"
          >
            <p id="error-summary-title" className="text-sm font-medium text-(--color-danger-fg)">
              {t("errorSummary.title")}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {errorEntries.map((entry) => (
                <li key={entry.questionId}>
                  {/* A plain in-page anchor: no-JS jump to the field, whose wrapper
                      carries id={questionId} (the 030 focus handle). */}
                  <a
                    href={`#${entry.questionId}`}
                    className="text-sm text-(--color-danger-fg) underline"
                  >
                    {entry.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {initial.step !== null ? (
          <A2UIStepRenderer
            document={documentForVisible(
              initial.step as unknown as A2UIStepDocument,
              initial.flowState.visibleQuestions,
            )}
            values={values}
            errors={errors}
            specVersion={initial.a2uiSpecVersion}
            nativeSubmit={{
              action,
              submitLabel,
              submitClassName: buttonClass("primary"),
            }}
          />
        ) : (
          // The flow is already complete (e.g. a resumed, fully-answered session):
          // a bare native form so the respondent can still POST the submit.
          <form method="post" action={action} className="flex flex-col gap-6">
            <p className="text-sm leading-relaxed text-(--color-text-muted)">
              {t("flow.submitReady")}
            </p>
            <div className="flex items-center justify-end">
              <button type="submit" className={buttonClass("primary")}>
                {t("action.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </PortalShell>
  );
}
