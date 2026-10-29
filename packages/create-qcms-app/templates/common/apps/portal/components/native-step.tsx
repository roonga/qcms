import { A2UIStepRenderer, expandRepeatGroups, hasRepeatGroup } from "@roonga/qcms-ui";
import type { A2UIErrors, A2UIStepDocument, A2UIValues } from "@roonga/qcms-ui";
import { useActionState } from "react";

import { useAppLocale } from "@/components/locale-context";
import { PortalShell } from "@/components/portal-shell";
import { rosterOperation } from "@/app/s/[sessionId]/roster-action";
import {
  instanceLabelTemplates,
  viewInstanceLabel,
  viewNarrowing,
  NO_ROSTER_ACTION,
  SESSION_FIELD,
} from "@/lib/repeat";
import { missingOnStep, requiredFieldErrors, stepSummaryEntries } from "@/lib/error-summary";
import { t } from "@/lib/i18n/en";
import { mergeStepValues } from "@/lib/step-values";
import { buttonClass } from "@/lib/ui";
import { authorMessageFor } from "@/lib/validation-message";
import { documentForVisible, messagesOf } from "@/lib/visible";
import { rosterMap } from "@/lib/rosters";
import type { StepContext } from "@/lib/server/route-helpers";
import type { StepResponse } from "@/lib/server/api";

// The author's message for the constraint the API refused on, else the default the BFF
// route resolved.
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

function viewProgress(
  initial: StepResponse,
  rosters: Readonly<Record<string, readonly string[]>>,
  stepDocument: A2UIStepDocument | null,
): { readonly current: number; readonly total: number; readonly label?: string } {
  const current = initial.progress.stepIndex + 1;
  const total = initial.progress.totalVisibleSteps;
  // Read off the stored document's template, so it is the same substitution the renderer
  // makes.
  const label = viewInstanceLabel(instanceLabelTemplates(stepDocument), rosters, initial.view);
  return label === undefined ? { current, total } : { current, total, label };
}

/**
 * The context carries a catalogue key and never a sentence, so a cookie from an earlier
 * build cannot put arbitrary text on the page; an unrecognised key renders nothing.
 */
function noticeFor(key: string | undefined): string | undefined {
  if (key === "step.notSaved") return t("step.notSaved");
  if (key === "step.countOutOfRange") return t("step.countOutOfRange");
  return undefined;
}

export function NativeStep({
  sessionId,
  initial,
  context,
  opToken,
  basePath,
}: {
  readonly sessionId: string;
  readonly initial: StepResponse;
  readonly context?: StepContext | undefined;
  /**
   * A prop and not a derivation: a client component cannot read the request header the
   * proxy resolved the environment on, and parsing `window.location` would make every
   * address below depend on the one the browser happens to be at (Q21).
   */
  readonly basePath: string;
  /**
   * Passed down rather than generated here: this component renders on the server and
   * again on the client before `ProgressiveStep` swaps it, and a value generated in the
   * component would differ between the two.
   */
  readonly opToken: string;
}) {
  const action = `${basePath}/s/${encodeURIComponent(sessionId)}/step`;
  const readyToSubmit = initial.flowState.readyToSubmit;
  const submitLabel = readyToSubmit ? t("action.submit") : t("action.continue");

  const [rosterState, rosterFormAction] = useActionState(rosterOperation, NO_ROSTER_ACTION);
  const locale = useAppLocale();

  const stepDocument = initial.step as unknown as A2UIStepDocument | null;
  const repeating = stepDocument !== null && hasRepeatGroup(stepDocument.root);
  // The route carries the constraint rather than the final string, because only this
  // render holds the compiled document the author's messages ride on (ADR-32).
  const refused: A2UIErrors = authoredErrors(stepDocument, context);
  const missing = missingOnStep(
    context?.missingRequired ?? [],
    initial.flowState.visibleQuestions,
    refused,
  );
  const visibleSet = new Set(initial.flowState.visibleQuestions);
  const rosters = rosterMap(initial.rosters);
  // Spread into both the pre-expansion and the renderer's own `repeat` prop, so the two
  // cannot narrow differently.
  const narrowed = viewNarrowing(initial.view);
  const viewProp = narrowed === undefined ? {} : { view: narrowed };
  const progress = viewProgress(initial, rosters, stepDocument);
  const expanded =
    stepDocument === null
      ? null
      : expandRepeatGroups(
          documentForVisible(stepDocument, initial.flowState.visibleQuestions).root,
          { rosters, visible: visibleSet, opToken, ...viewProp },
        );

  const expandedDocument: A2UIStepDocument | null =
    stepDocument === null || expanded === null
      ? null
      : { stepId: stepDocument.stepId, root: expanded };

  // The expanded document, so an authored required message on a question inside a group
  // is found: `missing` names those fields by their qualified name, which only the
  // expanded tree carries.
  const errors: A2UIErrors = { ...refused, ...requiredFieldErrors(expandedDocument, missing) };
  const values: A2UIValues = {
    ...mergeStepValues(initial.values, context?.values),
    ...rosterState.values,
  };
  // Each entry names its own question, so no two links can share an accessible name
  // (WCAG 3.3.1), and the expanded document is shared with the renderer so the anchors,
  // the labels and the rendered ids stay one set of strings.
  const errorEntries = stepSummaryEntries(
    expandedDocument,
    refused,
    missing,
    initial.flowState.visibleQuestions,
  );

  const notice = noticeFor(context?.notice);

  return (
    <PortalShell progress={progress}>
      <div className="flex flex-col gap-6">
        {notice === undefined ? null : (
          // Announced, not only painted: the respondent arrived at a freshly rendered
          // page and this is the one thing on it they did not ask for.
          <div
            role="alert"
            data-testid="step-notice"
            className="rounded-(--radius-card) border border-(--color-danger) bg-(--color-danger-subtle) p-4"
          >
            <p className="text-sm text-(--color-danger-fg)">{notice}</p>
          </div>
        )}
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

        {rosterState.message !== undefined ? (
          <p role="alert" className="text-sm text-(--color-danger-fg)">
            {rosterState.message}
          </p>
        ) : null}

        {expandedDocument !== null ? (
          <A2UIStepRenderer
            document={expandedDocument}
            values={values}
            errors={errors}
            // The same tag the scripted view passes, which is what keeps the no-JS date
            // field's segment order fixed across hydration.
            locale={locale}
            specVersion={initial.a2uiSpecVersion}
            nativeSubmit={{
              action,
              submitLabel,
              submitClassName: buttonClass("primary"),
              // Only when the step has a group: a step without one keeps its string
              // action and grows no framework entry point it has no use for.
              ...(repeating
                ? { formAction: rosterFormAction, hiddenFields: { [SESSION_FIELD]: sessionId } }
                : {}),
            }}
            repeat={{
              rosters,
              visible: visibleSet,
              opToken,
              ...viewProp,
              ...(rosterState.autofocusId !== undefined
                ? { autofocusId: rosterState.autofocusId }
                : {}),
            }}
          />
        ) : (
          // The flow is already complete, so a bare native form is all the respondent
          // needs to POST the submit.
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
