"use client";

import { A2UIStepRenderer } from "@qcms/ui";
import type { A2UIAnswerValue, A2UIErrors, A2UIStepDocument, A2UIValues } from "@qcms/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { PortalShell } from "@/components/portal-shell";
import {
  diffFlow,
  focusQuestion,
  nextFocusTargetAfterRemoval,
  questionIdOf,
  type FlowDelta,
  type FlowView,
} from "@/lib/a11y";
import { missingRequiredEntries } from "@/lib/error-summary";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";
import { commitMoments, documentForVisible, DEFAULT_COMMIT_MOMENT } from "@/lib/visible";
import type { CommitMoment } from "@/lib/visible";
import type { StepResponse } from "@/lib/server/api";

/** The localized branch-change announcement for an inserted/removed count. */
function branchAnnouncement(added: readonly string[], removed: readonly string[]): string {
  if (added.length > 0) {
    return added.length === 1
      ? t("announce.branchAdded.one")
      : t("announce.branchAdded.other", { count: added.length });
  }
  if (removed.length > 0) {
    return removed.length === 1
      ? t("announce.branchRemoved.one")
      : t("announce.branchRemoved.other", { count: removed.length });
  }
  return "";
}

/**
 * The "already recorded server-side" fingerprint for a set of held answers, in the
 * same encoding `lastPostedRef` uses for values this client posted (issue #146).
 *
 * Seeding it alongside the displayed values is what makes a resumed control inert
 * until the respondent actually changes something: without it, focus entering and
 * leaving an untouched control looked like a fresh commit of an emptied field and
 * posted a `null` RETRACTION of an answer the server legitimately held - the answer
 * was destroyed by a gesture that changed nothing. `handleBlur` guards only the
 * `completion` moment, so that reached every OTHER control regardless of its commit
 * moment: `blur` (shortText, longText, number), `groupExit` (multiChoice) and
 * `change` (boolean, singleChoice) alike.
 *
 * It also restores the other direction: a resumed `completion` control (the date)
 * whose value the respondent clears can only be recognised as retracting a
 * *previously answered* question by comparing against this record, so without the
 * seed that clear posted nothing at all and the server kept the cleared date.
 */
function recordedValues(held: StepResponse["values"]): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const [questionId, value] of Object.entries(held)) {
    recorded[questionId] = JSON.stringify(value);
  }
  return recorded;
}

const flowViewOf = (snapshot: StepResponse): FlowView => ({
  // The RENDERED step document's id (the explicit cursor's step, ADR-28), not
  // flowState.currentStep (the derived first-incomplete step, which may differ).
  stepId: snapshot.step?.stepId ?? null,
  stepIndex: snapshot.progress.stepIndex,
  visibleQuestions: snapshot.flowState.visibleQuestions,
});

/**
 * The live-region text for a projection change, in priority order: a step change
 * (largest shift) > becoming ready (clearer than reporting the now-hidden
 * questions as a bulk removal) > a branch insertion/removal count.
 */
function announcementText(
  delta: FlowDelta,
  becameReady: boolean,
  stepIndex: number,
  total: number,
  headingText: string | undefined,
): string {
  if (delta.stepChanged) {
    const current = stepIndex + 1;
    return headingText
      ? t("announce.stepChange", { current, total, title: headingText })
      : t("announce.stepChangeNoTitle", { current, total });
  }
  if (becameReady) return t("announce.ready");
  return branchAnnouncement(delta.added, delta.removed);
}

/**
 * Recover focus after a projection when it would otherwise fall to <body>: the
 * focused question was removed by a branch change (next visible question, else
 * the step heading), or a remount lost focus from a still-visible question
 * (restore it). A branch INSERT keeps focus on the answered control, so this is a
 * no-op there. Step navigation is handled separately (focus the new heading).
 * Owns the within-step focus policy (030).
 */
function recoverFocus(args: {
  readonly container: HTMLElement | null;
  readonly focused: string;
  readonly delta: FlowDelta;
  readonly previousVisible: readonly string[];
  readonly nextVisible: ReadonlySet<string>;
}): void {
  const focusLost = document.activeElement === null || document.activeElement === document.body;
  const { container } = args;
  if (container === null) return;
  if (args.delta.removed.includes(args.focused)) {
    const target = nextFocusTargetAfterRemoval(
      args.previousVisible,
      args.focused,
      args.nextVisible,
    );
    if (target !== undefined && focusQuestion(container, target)) return;
    const heading = container.querySelector<HTMLElement>("h1, h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  } else if (args.nextVisible.has(args.focused) && focusLost) {
    focusQuestion(container, args.focused);
  }
}

/**
 * The hydrated flow with an explicit navigation cursor (029/030, ADR-28). The
 * server sends the first `StepResponse` (real content, so the SSR first paint is
 * real); this component owns the local answer values, posts each answer to the
 * same-origin BFF proxy at that control's ADR-31 commit moment, and re-renders
 * branching *within the current step* from the API's returned flow projection.
 *
 * Navigation is a COMMITTED cursor, never a side effect of answering: **Continue**
 * requests the next visible step (only when the current step's required questions
 * are satisfied), **Back** requests the previous one, **Submit** appears only on
 * the final visible step. A step never collapses or advances because a question
 * was answered, so a multi-choice keeps every selection and a late-reopened
 * required question never yanks the respondent backward (findings M/N).
 *
 * The session token never touches client JS - the BFF attaches it from the
 * httpOnly cookie. The portal never evaluates rules; every projection comes from
 * the API, and Continue/Submit gate on the API's authoritative `flowState` (R2).
 *
 * `StepResponse` is imported type-only, so no server module reaches the client
 * bundle (enforced by the R2 import-surface test).
 */
export function StepFlow({
  sessionId,
  initial,
}: {
  readonly sessionId: string;
  readonly initial: StepResponse;
}) {
  const [snapshot, setSnapshot] = useState<StepResponse>(initial);
  // Seeded from the answers the server already holds for this step (issue #146).
  // A resumed session used to mount with an empty map, so every previously
  // answered question on the resumed step rendered EMPTY over a server that still
  // held the answer. The values arrive beside the compiled document, never inside
  // it (ADR-18), and they are only ever handed to the renderer as display state:
  // visibility still comes from `flowState.visibleQuestions` and the
  // Continue/Submit gate from `missingRequired` / `readyToSubmit`, both computed
  // by the API and never re-derived here (R2).
  const [values, setValues] = useState<A2UIValues>(initial.values);
  const [errors, setErrors] = useState<A2UIErrors>({});
  const [showMissing, setShowMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const valuesRef = useRef<A2UIValues>(values);
  valuesRef.current = values;
  // The last server projection, read inside queued callbacks so a navigation or
  // submit guard sees the projection left by any answer post that ran just ahead
  // of it. Updated ONLY where the snapshot changes (each answer post and each
  // navigation), never on every render - a render-time reassignment could clobber
  // the fresh server response with stale state from an interleaved re-render
  // (setBusy / setValues), making a just-completed answer look unfinished.
  const snapshotRef = useRef<StepResponse>(snapshot);
  // Answer posts and navigations are serialized on one queue: a follow-up answer
  // must not overtake the answer that made its question visible (else the API
  // rejects it 409 not-visible), and a Continue must evaluate its gate only after
  // any in-flight answer (e.g. a blur post triggered by the click) has landed.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // The value currently recorded server-side per question, so a blur does not
  // re-post an answer a change already posted. Without this, selecting a discrete
  // control (which posts on change) and then clicking Continue/Submit blurs the
  // control and re-posts the identical value: a redundant append that also flips
  // `busy` at exactly the wrong moment and races the advance guard. Seeded from the
  // answers the server holds for this step (issue #146) and then updated by each
  // successful post, so "what the server has" is known from the first render rather
  // than only from this client's own writes - see `recordedValues`.
  const lastPostedRef = useRef<Record<string, string>>(recordedValues(initial.values));
  // Each question's ADR-31 commit moment, read out of the compiled step document
  // (issue #31). Derived from the FULL document, not the visibility-pruned copy,
  // so a question the projection is about to reveal is already classified.
  // Recomputed only when the step document changes, not on every keystroke.
  const moments = useMemo(
    () =>
      snapshot.step === null
        ? (new Map() as ReadonlyMap<string, CommitMoment>)
        : commitMoments(snapshot.step as unknown as A2UIStepDocument),
    [snapshot.step],
  );

  // Flow-level accessibility (task 030): the step content region (for focus
  // targeting and reading the step heading), the previous flow projection (to
  // diff for announcements + focus), the question that held focus at the moment
  // an answer post returned (to recover focus if a branch change removed it),
  // the error summary (focused on a blocked submit), and the last readiness (to
  // announce becoming ready).
  const fieldsRef = useRef<HTMLDivElement>(null);
  const prevFlowRef = useRef<FlowView | undefined>(undefined);
  const focusedAtUpdateRef = useRef<string | undefined>(undefined);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const prevReadyRef = useRef<boolean>(initial.flowState.readyToSubmit);

  const sendAnswer = useCallback(
    async (name: string, value: A2UIAnswerValue | undefined): Promise<void> => {
      setBusy(true);
      try {
        const res = await fetch(`/s/${encodeURIComponent(sessionId)}/answers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Carry the committed cursor so the API re-renders THIS step, never
          // advancing away from it as a side effect of answering (ADR-28).
          body: JSON.stringify({
            questionId: name,
            value: value ?? null,
            step: snapshotRef.current.progress.stepIndex,
          }),
        });
        if (res.status === 200) {
          const next = (await res.json()) as StepResponse;
          // This value is now the last one posted for this question.
          lastPostedRef.current[name] = JSON.stringify(value ?? null);
          // Record which question holds focus right now, so the post-render
          // effect can recover focus if this projection removes it (task 030).
          focusedAtUpdateRef.current = questionIdOf(document.activeElement);
          // Update the ref synchronously (not only via the render) so a queued
          // navigation/advance chained right after this post reads fresh state.
          snapshotRef.current = next;
          setSnapshot(next);
          setErrors((prev) => {
            const rest = { ...prev };
            delete rest[name];
            return rest;
          });
        } else if (res.status === 422) {
          setErrors((prev) => ({ ...prev, [name]: t("answer.invalid") }));
        } else if (res.status === 401) {
          window.location.assign(`/s/${encodeURIComponent(sessionId)}`);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  const postAnswer = useCallback(
    (name: string, value: A2UIAnswerValue | undefined): void => {
      queueRef.current = queueRef.current.then(() => sendAnswer(name, value));
    },
    [sendAnswer],
  );

  const handleChange = useCallback(
    (name: string, value: A2UIAnswerValue | undefined): void => {
      setValues((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[name];
        else next[name] = value;
        return next;
      });
      // ADR-31: post exactly at this control's commit moment, so the same-step
      // reveal the server sends back lands at the moment the respondent finished
      // saying this one thing. `change` is a whole answer per event (a boolean or
      // singleChoice selection - posting those on blur is issue #31, where a
      // branch a singleChoice gates appeared only after focus left the radio
      // group). `completion`, `blur` and `groupExit` all commit in handleBlur
      // below. The control kind comes from the compiled document because the value
      // alone cannot separate a singleChoice OptionId from a date or a long-text
      // string. Nothing else posts here: a change mid-entry is a keystroke, a
      // segment or one toggle of a multi-select, none of which is an answer.
      const moment = moments.get(name) ?? DEFAULT_COMMIT_MOMENT;
      if (moment === "change") {
        postAnswer(name, value);
        return;
      }
      // ADR-31 (amended) x ADR-33: a previously-answered `completion` control
      // whose value clears posts its RETRACTION here, because the adapter only
      // surfaces the clear (`setValue(undefined)`, no blur - so the stale value
      // cannot re-post behind it) once editing has ended: this change event IS
      // the commit moment. A never-answered clear is not an answer and posts
      // nothing; a retraction already posted is deduped by lastPostedRef.
      const last = lastPostedRef.current[name];
      if (moment === "completion" && value === undefined && last !== undefined && last !== "null") {
        postAnswer(name, value);
      }
    },
    [moments, postAnswer],
  );

  /**
   * The renderer calls this only when focus leaves the WHOLE control (its
   * `FieldBlur` wrapper ignores a focusout whose `relatedTarget` is still inside,
   * and treats `relatedTarget === null` - a click on the page background, or a tab
   * out of the document - as leaving). That containment check is exactly ADR-31's
   * `groupExit` for a multiChoice: moving between the group's own checkboxes is
   * not a commit, leaving the group is. It is also the `blur` commit for number,
   * longText and shortText, and where a `completion` control commits.
   *
   * A `completion` control (the date) commits ONLY a complete value here: an
   * unfinished never-answered date is not an answer. The one `null` it can post
   * is the ADR-33 retraction of a previously-answered value, which travels via
   * handleChange (the adapter surfaces a clear only after editing ends). See
   * `visible.ts` for why the DatePicker's own "value is non-empty" signal cannot
   * be the trigger.
   */
  const handleBlur = useCallback(
    (name: string): void => {
      const value = valuesRef.current[name];
      if ((moments.get(name) ?? DEFAULT_COMMIT_MOMENT) === "completion" && value === undefined) {
        return;
      }
      // Skip the post if this exact value was already posted (e.g. a control that
      // committed on change): re-posting on blur is a redundant append and races
      // the advance guard.
      if (lastPostedRef.current[name] === JSON.stringify(value ?? null)) return;
      postAnswer(name, value);
    },
    [moments, postAnswer],
  );

  const doSubmit = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch(`/s/${encodeURIComponent(sessionId)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        const body = (await res.json()) as { redirect?: string };
        window.location.assign(body.redirect ?? "/done");
        return;
      }
      if (res.status === 422) {
        setShowMissing(true);
      } else if (res.status === 401) {
        window.location.assign(`/s/${encodeURIComponent(sessionId)}`);
        return;
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }, [sessionId]);

  /**
   * Fetch the requested step by cursor index (or the first incomplete step when
   * `target === "current"`) and render it. The BFF attaches the bearer and
   * forwards the cursor; the portal performs no rule evaluation (R2).
   *
   * The response's held answers are adopted into the displayed values (issue
   * #146), so navigating to a step this client never filled in - Back to an
   * earlier step of a resumed session, Continue into a step answered before the
   * page was reloaded - shows what the server holds instead of empty controls.
   * Held answers are merged over, not swapped in: a key the server has wins (it is
   * the ledger), and a key it does not have leaves the local entry alone, so a
   * value this client is still carrying is never dropped.
   *
   * Deliberately NOT done on each answer post's response, even though it returns
   * the same projection: a post lands while the respondent may be typing in
   * another already-answered control, and adopting there would overwrite the
   * characters they just typed with the value the server still holds. A navigation
   * has no such in-flight edit (it is queued behind any pending post, and focus
   * moves to the new step's heading).
   */
  const doNavigate = useCallback(
    async (target: number | "current"): Promise<void> => {
      setBusy(true);
      try {
        const query = target === "current" ? "" : `?step=${encodeURIComponent(String(target))}`;
        const res = await fetch(`/s/${encodeURIComponent(sessionId)}/step${query}`);
        if (res.status === 200) {
          const next = (await res.json()) as StepResponse;
          // Navigation lands focus on the new step's heading (see the effect), so
          // no per-question focus recovery is requested here.
          focusedAtUpdateRef.current = undefined;
          snapshotRef.current = next;
          setValues((prev) => ({ ...prev, ...next.values }));
          lastPostedRef.current = {
            ...lastPostedRef.current,
            ...recordedValues(next.values),
          };
          setSnapshot(next);
        } else if (res.status === 401) {
          window.location.assign(`/s/${encodeURIComponent(sessionId)}`);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  /**
   * Advance on Continue/Submit. Queued after any pending answer post so the gate
   * reads the freshest projection: on a non-final step, Continue advances only
   * when this step's required questions are satisfied (else the error summary
   * shows and the step does not advance); on the final step, Submit submits when
   * ready, shows the error summary when this step still has a gap, or navigates to
   * the first incomplete step when a re-opened earlier required question blocks it
   * (finding N - an explicit action, never a silent backward jump).
   */
  const attemptAdvance = useCallback((): void => {
    queueRef.current = queueRef.current.then(async () => {
      const snap = snapshotRef.current;
      const index = snap.progress.stepIndex;
      const total = snap.progress.totalVisibleSteps;
      const stepQuestions = new Set(snap.flowState.visibleQuestions);
      const stepMissing = snap.flowState.missingRequired.filter((q) => stepQuestions.has(q));
      const onFinalStep = index >= total - 1;

      if (onFinalStep) {
        if (snap.flowState.readyToSubmit) {
          await doSubmit();
          return;
        }
        if (stepMissing.length > 0) {
          setShowMissing(true);
          return;
        }
        await doNavigate("current");
        setShowMissing(true);
        return;
      }
      if (stepMissing.length > 0) {
        setShowMissing(true);
        return;
      }
      setShowMissing(false);
      await doNavigate(index + 1);
    });
  }, [doNavigate, doSubmit]);

  const goBack = useCallback((): void => {
    queueRef.current = queueRef.current.then(async () => {
      const index = snapshotRef.current.progress.stepIndex;
      if (index <= 0) return;
      setShowMissing(false);
      await doNavigate(index - 1);
    });
  }, [doNavigate]);

  const stepIndex = snapshot.progress.stepIndex;
  const total = snapshot.progress.totalVisibleSteps;
  const isFirstStep = stepIndex <= 0;
  const isFinalStep = stepIndex >= total - 1;
  const progress = { current: stepIndex + 1, total };
  const primaryLabel = isFinalStep ? t("action.submit") : t("action.continue");

  // The error summary lists only the CURRENT step's still-missing required
  // questions (those are what block Continue/Submit here), from the API's
  // authoritative set intersected with this step's visible questions.
  const stepVisible = new Set(snapshot.flowState.visibleQuestions);
  const missing = showMissing
    ? snapshot.flowState.missingRequired.filter((q) => stepVisible.has(q))
    : [];
  // Each entry names its own question, so the summary links have distinct
  // accessible names (WCAG 3.3.1, issue #21). The label comes from the step
  // document the portal already holds, never from a second request.
  const missingEntries = missingRequiredEntries(
    snapshot.step as unknown as A2UIStepDocument | null,
    missing,
  );

  // Announce step/branch changes and manage focus after each projection (030).
  // The SSR first paint needs neither (nothing changed yet), so the diff against
  // `prevFlowRef` is empty on mount and this becomes active from the first action.
  useEffect(() => {
    const container = fieldsRef.current;
    const previous = prevFlowRef.current;
    const next = flowViewOf(snapshot);
    const delta = diffFlow(previous, next);
    prevFlowRef.current = next;

    const ready = snapshot.flowState.readyToSubmit;
    const becameReady = previous !== undefined && !prevReadyRef.current && ready;
    prevReadyRef.current = ready;

    // The step's title heading: the step document's first heading (h1 on the
    // first step, which also carries the form title; an h2 on later steps).
    const headingText = container?.querySelector("h1, h2")?.textContent?.trim() || undefined;
    setAnnouncement(
      announcementText(
        delta,
        becameReady,
        next.stepIndex,
        snapshot.progress.totalVisibleSteps,
        headingText,
      ),
    );

    // Explicit navigation to a different step: land focus at the new step's
    // heading so keyboard and screen-reader users start at the top of the step.
    if (delta.stepChanged && previous !== undefined) {
      const heading = container?.querySelector<HTMLElement>("h1, h2");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
      focusedAtUpdateRef.current = undefined;
      return;
    }

    const focused = focusedAtUpdateRef.current;
    focusedAtUpdateRef.current = undefined;
    if (focused === undefined) return;
    recoverFocus({
      container,
      focused,
      delta,
      previousVisible: previous?.visibleQuestions ?? [],
      nextVisible: new Set(next.visibleQuestions),
    });
  }, [snapshot]);

  // A blocked submit/continue moves focus to the error summary (WCAG 3.3.1); its
  // role="alert" reads the summary heading. Each entry then jumps to its field.
  useEffect(() => {
    if (showMissing && missing.length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [showMissing, missing.length]);

  const focusMissingField = useCallback(
    (questionId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (fieldsRef.current) focusQuestion(fieldsRef.current, questionId);
    },
    [],
  );

  return (
    <PortalShell progress={progress}>
      <div className="flex flex-col gap-6">
        {/* Polite live region for step and branch-change announcements (030).
            Always present so screen readers register it; content is read on
            change. Visually hidden - the change is already visible on screen. */}
        <div aria-live="polite" className="sr-only" data-testid="flow-announcer">
          {announcement}
        </div>

        {failed ? (
          <p role="alert" className="text-sm text-(--color-danger-fg)">
            {t("session.lost.body")}
          </p>
        ) : null}

        {missing.length > 0 ? (
          <div
            ref={errorSummaryRef}
            role="alert"
            tabIndex={-1}
            aria-labelledby="error-summary-title"
            data-testid="error-summary"
            className="rounded-lg border border-(--color-danger) bg-(--color-danger-subtle) p-4 outline-none"
          >
            <p id="error-summary-title" className="text-sm font-medium text-(--color-danger-fg)">
              {t("errorSummary.title")}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {missingEntries.map((entry) => (
                <li key={entry.questionId}>
                  <a
                    href={`#${entry.questionId}`}
                    onClick={focusMissingField(entry.questionId)}
                    className="text-sm text-(--color-danger-fg) underline"
                  >
                    {entry.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {snapshot.step !== null ? (
          <div ref={fieldsRef}>
            <A2UIStepRenderer
              document={documentForVisible(
                snapshot.step as unknown as A2UIStepDocument,
                snapshot.flowState.visibleQuestions,
              )}
              values={values}
              errors={errors}
              onChange={handleChange}
              onBlur={handleBlur}
              specVersion={snapshot.a2uiSpecVersion}
            />
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-(--color-text-muted)">
            {t("flow.submitReady")}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          {isFirstStep ? (
            // Back is hidden on the first visible step (042 wireframe); keep the
            // primary action right-aligned with a spacer.
            <span aria-hidden="true" />
          ) : (
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={goBack}
              disabled={busy}
              data-testid="back-action"
            >
              {t("action.back")}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className={buttonClass("primary")}
            onClick={attemptAdvance}
            disabled={busy}
            data-testid="primary-action"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </PortalShell>
  );
}
