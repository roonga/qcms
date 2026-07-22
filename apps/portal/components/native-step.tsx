import { A2UIStepRenderer } from "@qcms/ui";
import type { A2UIErrors, A2UIStepDocument, A2UIValues } from "@qcms/ui";

import { PortalShell } from "@/components/portal-shell";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";
import { documentForVisible } from "@/lib/visible";
import type { StepContext } from "@/lib/server/route-helpers";
import type { StepResponse } from "@/lib/server/api";

/**
 * The no-JS step view (task 044): the progressive-enhancement fallback the SSR
 * paints when JavaScript is unavailable. It renders the current step inside the
 * @qcms/ui renderer's opt-in native-submit mode - a real
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

  const errors: A2UIErrors = context?.errors ?? {};
  const values: A2UIValues = context?.values ?? {};
  const errorEntries = Object.entries(errors).filter(([, message]) => message !== undefined);

  return (
    <PortalShell progress={progress}>
      <div className="flex flex-col gap-6">
        {errorEntries.length > 0 ? (
          <div
            role="alert"
            aria-labelledby="error-summary-title"
            data-testid="error-summary"
            className="rounded-lg border border-(--color-danger) bg-(--color-danger-subtle) p-4"
          >
            <p id="error-summary-title" className="text-sm font-medium text-(--color-danger-fg)">
              {t("errorSummary.title")}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {errorEntries.map(([questionId, message]) => (
                <li key={questionId}>
                  {/* A plain in-page anchor: no-JS jump to the field, whose wrapper
                      carries id={questionId} (the 030 focus handle). */}
                  <a href={`#${questionId}`} className="text-sm text-(--color-danger-fg) underline">
                    {message}
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
