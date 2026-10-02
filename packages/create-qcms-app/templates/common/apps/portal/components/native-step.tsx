import { A2UIStepRenderer, expandRepeatGroups, hasRepeatGroup } from "@roonga/qcms-ui";
import type { A2UIErrors, A2UIStepDocument, A2UIValues } from "@roonga/qcms-ui";
import { useActionState } from "react";

import { PortalShell } from "@/components/portal-shell";
import { rosterOperation } from "@/app/s/[sessionId]/roster-action";
import {
  instanceLabelTemplates,
  viewInstanceLabel,
  viewNarrowing,
  NO_ROSTER_ACTION,
  SESSION_FIELD,
} from "@/lib/repeat";
import {
  errorSummaryEntries,
  missingOnStep,
  missingRequiredEntries,
  orderedEntries,
  requiredFieldErrors,
} from "@/lib/error-summary";
import { t } from "@/lib/i18n/en";
import { PORTAL_LOCALE } from "@/lib/i18n/format";
import { mergeStepValues } from "@/lib/step-values";
import { buttonClass } from "@/lib/ui";
import { authorMessageFor } from "@/lib/validation-message";
import { documentForVisible, messagesOf } from "@/lib/visible";
import { rosterMap } from "@/lib/rosters";
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
 * reaches the client bundle (the R2 import-surface test enforces this). The one
 * value import from a server module is the **Server Action** below, which is what a
 * `"use server"` module is for: React sends a reference, never the code.
 *
 * ## The repeating group, and why this view holds a Server Action (task 073)
 *
 * A step carrying a repeating group has one form and two destinations. Continue posts
 * to the whole-step BFF route and gets a 303, unchanged. An **Add or Remove** posts to
 * `rosterOperation`, a Next Server Action, which applies the roster operation, commits
 * no answer, and lets Next re-render this step in the **same 200 response** - which is
 * what carries the respondent's typed values back with no cookie and no redirect
 * (ADR-43 as amended, Code Owner 2026-10-01). `useActionState` is how the returned
 * values reach the render: React renders that state server-side, before any hydration,
 * which is exactly the no-JS case.
 *
 * The action is attached to the FORM and Continue carries a plain URL `formaction`, so
 * React is nowhere near the `__qop` buttons: those stay ordinary
 * `<button name value formnovalidate>` markup, which is the ruled mechanism (Q9) and
 * needs no framework behaviour to serialize.
 *
 * **A step with no repeating group is rendered exactly as before**: no action is
 * passed, the form keeps its string `action`, and nothing about the seven no-JS specs
 * moves.
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
  opToken,
}: {
  readonly sessionId: string;
  readonly initial: StepResponse;
  readonly context?: StepContext | undefined;
  /**
   * The one-time roster-operation token this page render minted (task 073, ADR-43).
   *
   * Minted on the server, once per page render, and passed down rather than generated
   * here: this component renders on the server and again on the client before
   * `ProgressiveStep` swaps it, and a value generated in the component would differ
   * between the two. The API records it with the roster row it writes, so a post that
   * arrives twice applies once.
   */
  readonly opToken: string;
}) {
  const action = `/s/${encodeURIComponent(sessionId)}/step`;
  const readyToSubmit = initial.flowState.readyToSubmit;
  const submitLabel = readyToSubmit ? t("action.submit") : t("action.continue");
  const progress = {
    current: initial.progress.stepIndex + 1,
    total: initial.progress.totalVisibleSteps,
  };

  // The Server Action for this step's Add and Remove (task 073). `useActionState` is what
  // carries the action's returned values into the render, and React renders that state
  // server-side before any hydration, which is the whole of the no-JS case. The action id
  // React writes into the form is recalculated on every build, so a page held across a
  // deploy posts a stale one: `app/s/[sessionId]/error.tsx` is what turns that into a page
  // saying so rather than a framework error.
  //
  // NOT `rosterOperation.bind(null, sessionId)`, and this is the one line in the file that
  // must not be "simplified" back. A bound reference handed to `useActionState` HANGS THE
  // SERVER RENDER: Next compares a bound action's signature asynchronously, that comparison
  // never settles inside a render, so the POST never gets a response and the process
  // accumulates promises until it dies with `RangeError: Map maximum size exceeded`. It
  // presents as the Add button doing nothing and then the whole server going away. The
  // session rides as a hidden input instead (`__qsid`, below), which is how plain HTML has
  // always given one form its context, and the action reads it out of the form data.
  const [rosterState, rosterFormAction] = useActionState(rosterOperation, NO_ROSTER_ACTION);

  const stepDocument = initial.step as unknown as A2UIStepDocument | null;
  const repeating = stepDocument !== null && hasRepeatGroup(stepDocument.root);
  // The author's wording wins over the default the BFF resolved, per constraint
  // (task 048, ADR-32). The route carries the CONSTRAINT rather than the final
  // string because only this render holds the compiled document the messages ride
  // on. A question the author left alone keeps the message the route produced.
  const refused: A2UIErrors = authoredErrors(stepDocument, context);
  // Required questions the API reports as still unanswered on the step just posted
  // (issue #920). The kernel decides required-ness and the API serves the set; this
  // render only shows it, the way the hydrated flow already shows it.
  const missing = missingOnStep(
    context?.missingRequired ?? [],
    initial.flowState.visibleQuestions,
    refused,
  );
  const visibleSet = new Set(initial.flowState.visibleQuestions);
  const rosters = rosterMap(initial.rosters);
  // The per-instance step view this page is, or `undefined` for every ordinary page
  // (task 076). The API named it; the only thing the portal does with it is draw one
  // instance of a roster it was handed in full, and put the group's Add control on the
  // last view alone (`expandRepeatGroups`). Without scripting there is **no Back**
  // (ADR-28's 2026-08-31 amendment), so the server chose this view: the first whose
  // instance is incomplete.
  const view = viewNarrowing(initial.view);
  // The chrome's name for this view ("Vehicle 2"), read off the STORED document's
  // template so it is the same substitution the renderer makes, and absent on every
  // page that is not a per-instance one (ADR-27).
  const viewLabel = viewInstanceLabel(instanceLabelTemplates(stepDocument), rosters, initial.view);
  const expanded =
    stepDocument === null
      ? null
      : expandRepeatGroups(
          documentForVisible(stepDocument, initial.flowState.visibleQuestions).root,
          { rosters, visible: visibleSet, opToken, ...(view !== undefined ? { view } : {}) },
        );

  const expandedDocument: A2UIStepDocument | null =
    stepDocument === null || expanded === null
      ? null
      : { stepId: stepDocument.stepId, root: expanded };

  // The expanded document, so an authored "required" message on a question INSIDE a group
  // is found: `missing` names those fields by their qualified name, which only the
  // expanded tree carries.
  const errors: A2UIErrors = { ...refused, ...requiredFieldErrors(expandedDocument, missing) };
  // The answers the API holds for this step (issue #146) under the just-submitted
  // ones from the no-JS re-render cookie. The cookie has to win, including when it
  // CLEARS a field: see `mergeStepValues`, which owns that three-way behaviour and
  // is tested for it (issue #327).
  // Three layers, outermost last, and the order is the order of authority: the answers
  // the API holds for this step (issue #146), then the just-submitted ones from the
  // Continue re-render cookie (which has to win even when it CLEARS a field - see
  // `mergeStepValues`, issue #327), then the values an Add or Remove carried back in
  // its own 200. The last is the most recent thing the respondent typed and the API
  // holds none of it, because that post writes no answer.
  //
  // The outermost layer is a plain spread rather than a third `mergeStepValues` call,
  // and the difference is real: that helper exists to propagate an own property whose
  // value is `undefined`, because a cookie entry mapped to `undefined` is a CLEAR. The
  // action's values carry no clears at all - a cleared field is simply absent from
  // them, since nothing was written and the API still holds the old answer - so there
  // is nothing here for that behaviour to preserve.
  const values: A2UIValues = {
    ...mergeStepValues(initial.values, context?.values),
    ...rosterState.values,
  };
  // The summary entries, composed by the module both portal paths share
  // (`lib/error-summary.ts`): each entry names its own question by label, or by
  // its position among this step's visible questions when the document carried no
  // label, so no two links can have the same accessible name (WCAG 3.3.1, issues
  // #21 and #326). This path once emitted the bare per-field message for a
  // label-less question, which two questions sharing one author message (ADR-32)
  // could collide on.
  // The EXPANDED document, and it is shared deliberately. The renderer expands a
  // `RepeatGroup` template per live instance and qualifies each clone's `name`, and the
  // error summary has to read the same names to find a field's label, its position and
  // its instance label. Expanding once here and handing the same tree to both is what
  // keeps the anchors, the labels and the rendered ids one set of strings; the
  // renderer's own expansion is idempotent, so passing it an expanded document leaves
  // it alone.
  const errorEntries = orderedEntries(
    [
      ...errorSummaryEntries(expandedDocument, refused, initial.flowState.visibleQuestions),
      // The hydrated flow's own composition, called rather than restated, so both
      // paths name a missing required question the same way (issue #21, #326).
      ...missingRequiredEntries(expandedDocument, missing, initial.flowState.visibleQuestions),
    ],
    initial.flowState.visibleQuestions,
  );

  // A page-level notice for a round trip that wrote nothing and has nothing per field to
  // say: a refused batch (ruling Q29). It is a KEY in the cookie, looked up here, because
  // the catalogue is where the portal's wording lives; an unrecognised key renders nothing,
  // so a cookie from an earlier build cannot put a blank banner on the page.
  const notice = context?.notice === "step.notSaved" ? t("step.notSaved") : undefined;

  return (
    <PortalShell progress={{ ...progress, ...(viewLabel === undefined ? {} : { label: viewLabel }) }}>
      <div className="flex flex-col gap-6">
        {notice === undefined ? null : (
          // `role="alert"`, like the error summary beside it: the respondent arrived at a
          // freshly rendered page, so this is the one thing on it they did not ask for and
          // it has to be announced rather than only painted.
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
            // Same reason as the scripted view (issue #729): the portal names its own
            // locale for react-aria instead of inheriting the renderer's `en-US` default.
            locale={PORTAL_LOCALE}
            specVersion={initial.a2uiSpecVersion}
            nativeSubmit={{
              action,
              submitLabel,
              submitClassName: buttonClass("primary"),
              // The Server Action goes on the FORM only when this step actually has a
              // group to add to or remove from. A step without one keeps the string
              // action it always had, so nothing about the seven no-JS specs moves and
              // no page grows a framework entry point it has no use for.
              ...(repeating
                ? { formAction: rosterFormAction, hiddenFields: { [SESSION_FIELD]: sessionId } }
                : {}),
            }}
            repeat={{
              rosters,
              visible: visibleSet,
              opToken,
              // The same narrowing the pre-expansion above already applied. The
              // renderer's own expansion is idempotent, so this is what keeps the two
              // in step if a document ever reaches it unexpanded.
              ...(view !== undefined ? { view } : {}),
              ...(rosterState.autofocusId !== undefined
                ? { autofocusId: rosterState.autofocusId }
                : {}),
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
