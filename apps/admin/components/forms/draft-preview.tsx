"use client";

import {
  A2UIStepRenderer,
  documentForVisible,
  type A2UIAnswerValue,
  type A2UIStepDocument,
  type A2UIValues,
} from "@qcms/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Button } from "@/components/kit";
import { IssueEntry } from "@/components/forms/validation-panel";
import type { DraftPreviewState } from "@/lib/forms/builder-state";
import { IDLE_DRAFT_PREVIEW } from "@/lib/forms/builder-state";
import type { CompiledStep, DraftForm } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The live draft preview (task 034; wireframe "preview").
 *
 * ## Why this is the same thing a respondent gets, and not a lookalike
 *
 * Three pieces have to be shared for a preview to be worth anything, and all three are:
 *
 * 1. **The compile.** The draft is compiled by `compileForm` in the API - the same call,
 *    in the same process, that publish makes. There is no admin-side compiler (there could
 *    not be one: `renderer-surface.test.ts` forbids importing `@qcms/a2ui-compiler` here).
 * 2. **The projection.** `documentForVisible` from `@qcms/ui` is the function the portal
 *    uses to drop the questions the flow says are not visible. It moved into the shared
 *    package for this screen, precisely so there is one of it.
 * 3. **The renderer.** `A2UIStepRenderer` from `@qcms/ui` is the component the portal
 *    serves respondents with (ARCHITECTURE §6).
 *
 * So the preview's DOM for a step is the portal's DOM for that step, structurally, rather
 * than by resemblance.
 *
 * ## Why the branch walk is a round trip
 *
 * The wireframe describes "live rule evaluation (core evaluator client-side)". That is not
 * implementable and has already been ruled on once: the admin imports no `@qcms/core`
 * value at all (R2, `r2-import-surface.test.ts`), and 033's rule bench was moved into the
 * API for exactly this reason (amendment, 2026-08-01, PO seat). It is also not what the
 * portal does - the portal receives an authoritative `visibleQuestions` list and projects
 * onto it, performing no evaluation of its own. Doing the same here is therefore not a
 * compromise, it is the fidelity: a second evaluator in the admin would be the one part of
 * the preview that could disagree with what a respondent gets.
 *
 * Answers change, the pane re-asks, the API answers with the visible set. The answers live
 * in this component and die with it: no persistence, no session, nothing stored anywhere.
 *
 * ## The rendered step sits inside a styling seam
 *
 * `qcms-preview-surface` is a single container element that owns the preview's styling
 * boundary, and it is the *only* element the rendered step hangs off (Code Owner ruling,
 * 2026-08-02). Two things follow, and both are structural rather than visual:
 *
 * - Nothing in this path assumes the preview shares the admin's theme context. The
 *   surface is where a step's styling begins, so a change of styling context is a change
 *   to that one element and to nothing else.
 * - Task 058 mounts its theme island on this container. This task builds the boundary and
 *   deliberately not the switcher: there is no theme selection here, no mode switching,
 *   and no portal-theme defaulting.
 *
 * It also protects exit criterion 3. The fidelity comparison is of the rendered form
 * subtree *inside* the surface, so wrapping the surface later changes nothing the
 * deep-match asserts.
 */

/** How long to wait after the last keystroke before re-asking for the projection. */
const DEBOUNCE_MS = 250;

export function DraftPreview({
  draft,
  preview,
}: {
  readonly draft: DraftForm | null;
  readonly preview: (input: {
    readonly draft: DraftForm;
    readonly answers: Readonly<Record<string, unknown>>;
  }) => Promise<DraftPreviewState>;
}) {
  const [answers, setAnswers] = useState<A2UIValues>({});
  const [state, setState] = useState<DraftPreviewState>(IDLE_DRAFT_PREVIEW);
  const [stepIndex, setStepIndex] = useState(0);

  // Only the newest request may write the pane. Without this, a slow early request can
  // land after a fast later one and show the branch state for answers that are two
  // keystrokes stale, which reads exactly like a rule that does not work.
  const requestId = useRef(0);

  useEffect(() => {
    if (draft === null) return undefined;
    const id = requestId.current + 1;
    requestId.current = id;
    const timer = setTimeout(() => {
      setState((current) =>
        current.status === "ok" ? current : { ...current, status: "loading" },
      );
      void preview({ draft, answers }).then((next) => {
        if (requestId.current === id) setState(next);
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, answers, preview]);

  const handleChange = useCallback((name: string, value: A2UIAnswerValue | undefined): void => {
    setAnswers((previous) => {
      const next = { ...previous };
      // Delete rather than store `undefined`: the adapters read "no answer" as an absent
      // key, and a present key holding `undefined` sends react-aria down its uncontrolled
      // path (COMPONENT_GUIDELINES item 11). The portal does exactly this.
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setAnswers({});
    setStepIndex(0);
  }, []);

  const visibleSteps = useMemo(
    () => orderVisibleSteps(state.preview?.documents ?? [], state.preview?.flow.visibleSteps ?? []),
    [state.preview],
  );

  // A branch can remove the step the author is standing on. Clamping during render rather
  // than in an effect avoids painting one frame of an out-of-range step.
  const index = visibleSteps.length === 0 ? 0 : Math.min(stepIndex, visibleSteps.length - 1);
  const step = visibleSteps[index];

  return (
    <section
      aria-labelledby="qcms-preview-heading"
      className="flex flex-col gap-4"
      data-testid="qcms-draft-preview"
    >
      <div className="flex flex-col gap-1">
        <h2 id="qcms-preview-heading" className="text-lg font-semibold text-(--color-text)">
          {t("forms.preview.heading")}
        </h2>
        {/* Plain prose, not an `Alert`: this banner is always on screen and never
            announces a change, and `Alert` is a live region. */}
        <p className="qcms-preview-banner" data-testid="qcms-preview-banner">
          {t("forms.preview.banner")}
        </p>
        <p className="text-sm text-(--color-text-muted)">{t("forms.preview.explain")}</p>
      </div>

      {draft === null && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.preview.noSteps")}</p>
      )}

      <div aria-live="polite" className="flex flex-col gap-2">
        {state.status === "loading" && (
          <p className="text-sm text-(--color-text-muted)">{t("forms.preview.loading")}</p>
        )}
        {state.status === "error" && (
          <Alert variant="error">
            {t("forms.preview.failed", { message: state.message ?? "" })}
          </Alert>
        )}
      </div>

      {state.status === "rejected" && draft !== null && (
        <section
          aria-labelledby="qcms-preview-rejected-heading"
          data-testid="qcms-preview-rejected"
          className="flex flex-col gap-2 rounded-md border border-(--color-border-strong) bg-(--color-background-muted) p-4"
        >
          <h3
            id="qcms-preview-rejected-heading"
            className="text-base font-semibold text-(--color-text)"
          >
            {t("forms.preview.unavailable")}
          </h3>
          <p className="text-sm text-(--color-text-muted)">{t("forms.preview.unavailableHint")}</p>
          <ul className="flex flex-col gap-2">
            {(state.issues ?? []).map((issue, position) => (
              <li key={`${issue.code}:${String(position)}`}>
                <IssueEntry issue={issue} draft={draft} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.preview !== undefined && step !== undefined && (
        <>
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-preview-step">
            {t("forms.preview.stepOf", {
              index: index + 1,
              total: visibleSteps.length,
              title: stepTitle(draft, step.stepId),
            })}
          </p>

          <div className="qcms-preview qcms-preview-surface" data-testid="qcms-preview-surface">
            <A2UIStepRenderer
              document={documentForVisible(
                { stepId: step.stepId, root: step.root as A2UIStepDocument["root"] },
                state.preview.flow.visibleQuestions,
              )}
              values={answers}
              onChange={handleChange}
              specVersion={state.preview.a2uiSpecVersion}
            />
            {/* A visible step whose every question is currently hidden renders as an empty
                box, which reads as a broken preview rather than as the branch state it is.
                Whether that is the case is pure draft geometry - which questions this step
                pins, intersected with the visible set the API returned - so it needs no
                knowledge of what an A2UI node means (`renderer-surface.test.ts`). */}
            {!hasVisibleQuestion(draft, step.stepId, state.preview.flow.visibleQuestions) && (
              <p className="text-sm text-(--color-text-muted)" data-testid="qcms-preview-empty">
                {t("forms.preview.emptyStep")}
              </p>
            )}
          </div>

          {state.preview.flow.complete && (
            <p className="text-sm text-(--color-text-muted)" data-testid="qcms-preview-complete">
              {t("forms.preview.complete")}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              isDisabled={index === 0}
              onPress={() => {
                setStepIndex(index - 1);
              }}
            >
              {t("forms.preview.previous")}
            </Button>
            <Button
              variant="secondary"
              size="md"
              isDisabled={index >= visibleSteps.length - 1}
              onPress={() => {
                setStepIndex(index + 1);
              }}
            >
              {t("forms.preview.next")}
            </Button>
            <Button variant="ghost" size="md" onPress={reset}>
              {t("forms.preview.reset")}
            </Button>
          </div>

          <p className="text-xs text-(--color-text-muted)" data-testid="qcms-preview-stamps">
            {t("forms.preview.stamps", {
              compilerVersion: state.preview.compilerVersion,
              a2uiSpecVersion: state.preview.a2uiSpecVersion,
            })}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The step's authored title, for the "Step 2 of 3" line.
 *
 * Read from the draft rather than out of the compiled document: the compiled tree is the
 * renderer's, and reaching into it to find a heading node would be this app knowing what a
 * node means, which is the one thing it must not do (`renderer-surface.test.ts`). The
 * draft has the title in the open, in the form's default locale.
 */
function stepTitle(draft: DraftForm | null, stepId: string): string {
  const step = draft?.steps.find((candidate) => candidate.stepId === stepId);
  const title = step?.title[draft?.defaultLocale ?? ""];
  return title === undefined || title === "" ? stepId : title;
}

/**
 * Whether any question this step pins is in the visible set.
 *
 * Read from the draft rather than by walking the compiled tree, for the same reason
 * `stepTitle` is: the node tree belongs to the renderer, and this app is not allowed to
 * know what a node means. A step whose pins are all hidden is a real branch state, not a
 * failure, and saying so is the difference between a preview and an empty box.
 */
function hasVisibleQuestion(
  draft: DraftForm | null,
  stepId: string,
  visibleQuestions: readonly string[],
): boolean {
  const step = draft?.steps.find((candidate) => candidate.stepId === stepId);
  if (step === undefined) return true;
  const visible = new Set(visibleQuestions);
  return step.items.some((pin) => visible.has(pin.questionId));
}

/**
 * The compiled documents for the steps the flow says are visible, in the form's own step
 * order.
 *
 * Order comes from `documents` rather than from `visibleSteps` on purpose: the compiled
 * documents are emitted in the definition's step order, which is the order a respondent
 * walks them in, and a projection list is a set rather than a sequence.
 */
function orderVisibleSteps(
  documents: readonly CompiledStep[],
  visibleSteps: readonly string[],
): readonly CompiledStep[] {
  const visible = new Set(visibleSteps);
  return documents.filter((document) => visible.has(document.stepId));
}
