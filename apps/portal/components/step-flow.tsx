"use client";

import { A2UIStepRenderer } from "@qcms/ui";
import type { A2UIAnswerValue, A2UIErrors, A2UIStepDocument, A2UIValues } from "@qcms/ui";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";
import { documentForVisible } from "@/lib/visible";
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

const flowViewOf = (snapshot: StepResponse): FlowView => ({
  // The rendered step document's id (not flowState.currentStep, which also nulls
  // out on ready-to-submit within the same step) - see FlowView.stepId (030).
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
 * step collapsed to ready (land on the primary action), the focused question was
 * removed (next visible question, else the step heading), or a remount lost focus
 * from a still-visible question (restore it). A branch INSERT keeps focus on the
 * answered control, so this is a no-op there. Owns the focus policy (030).
 */
function recoverFocus(args: {
  readonly container: HTMLElement | null;
  readonly focused: string;
  readonly becameReady: boolean;
  readonly delta: FlowDelta;
  readonly previousVisible: readonly string[];
  readonly nextVisible: ReadonlySet<string>;
  readonly primary: HTMLButtonElement | null;
}): void {
  const focusLost = document.activeElement === null || document.activeElement === document.body;
  if (args.becameReady) {
    if (focusLost) args.primary?.focus();
    return;
  }
  const { container } = args;
  if (container === null) return;
  if (args.delta.removed.includes(args.focused)) {
    const target = nextFocusTargetAfterRemoval(
      args.previousVisible,
      args.focused,
      args.nextVisible,
    );
    if (target !== undefined && focusQuestion(container, target)) return;
    const heading = container.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  } else if (args.nextVisible.has(args.focused) && focusLost) {
    focusQuestion(container, args.focused);
  }
}

/**
 * The hydrated flow (019's per-answer model). The server sends the first
 * `StepResponse` (real content, so the SSR first paint is real); this component
 * owns the local answer values, posts each answer to the same-origin BFF proxy on
 * change/blur, and re-renders branching from the API's returned flow projection.
 * The session token never touches client JS - the BFF attaches it from the
 * httpOnly cookie. The portal never evaluates rules; every projection comes from
 * the API (R2).
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
  const [values, setValues] = useState<A2UIValues>({});
  const [errors, setErrors] = useState<A2UIErrors>({});
  const [showMissing, setShowMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const valuesRef = useRef<A2UIValues>(values);
  valuesRef.current = values;
  // Answer posts are serialized: a follow-up answer must not overtake the answer
  // that made its question visible (else the API rejects it 409 not-visible).
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // Flow-level accessibility (task 030): the step content region (for focus
  // targeting and reading the step heading), the previous flow projection (to
  // diff for announcements + focus), the question that held focus at the moment
  // an answer post returned (to recover focus if a branch change removed it),
  // and the error summary (focused on a blocked submit).
  const fieldsRef = useRef<HTMLDivElement>(null);
  const prevFlowRef = useRef<FlowView | undefined>(undefined);
  const focusedAtUpdateRef = useRef<string | undefined>(undefined);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const sendAnswer = useCallback(
    async (name: string, value: A2UIAnswerValue | undefined): Promise<void> => {
      setBusy(true);
      try {
        const res = await fetch(`/s/${encodeURIComponent(sessionId)}/answers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ questionId: name, value: value ?? null }),
        });
        if (res.status === 200) {
          const next = (await res.json()) as StepResponse;
          // Record which question holds focus right now, so the post-render
          // effect can recover focus if this projection removes it (task 030).
          focusedAtUpdateRef.current = questionIdOf(document.activeElement);
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
      // Discrete controls (booleans, choices) can flip branch visibility, so post
      // immediately; free-text and numbers post on blur (below) to avoid chatter.
      if (value === undefined || typeof value === "boolean" || Array.isArray(value)) {
        postAnswer(name, value);
      }
    },
    [postAnswer],
  );

  const handleBlur = useCallback(
    (name: string): void => {
      postAnswer(name, valuesRef.current[name]);
    },
    [postAnswer],
  );

  const submit = useCallback(async (): Promise<void> => {
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

  const onPrimary = useCallback((): void => {
    if (snapshot.flowState.readyToSubmit) void submit();
    else setShowMissing(true);
  }, [snapshot.flowState.readyToSubmit, submit]);

  // Announce step/branch changes and manage focus after each projection (030).
  // The SSR first paint needs neither (nothing changed yet), so the diff against
  // `prevFlowRef` is empty on mount and this becomes active from the first answer.
  useEffect(() => {
    const container = fieldsRef.current;
    const previous = prevFlowRef.current;
    const next = flowViewOf(snapshot);
    const delta = diffFlow(previous, next);
    prevFlowRef.current = next;

    // The last answer completed the step: the API drops `currentStep` to null and
    // the form collapses to the ready-to-submit state (serve-step handler).
    const becameReady = previous?.stepId != null && next.stepId === null;

    const headingText = container?.querySelector("h1")?.textContent?.trim() || undefined;
    setAnnouncement(
      announcementText(
        delta,
        becameReady,
        next.stepIndex,
        snapshot.progress.totalVisibleSteps,
        headingText,
      ),
    );

    const focused = focusedAtUpdateRef.current;
    focusedAtUpdateRef.current = undefined;
    if (focused === undefined) return;
    recoverFocus({
      container,
      focused,
      becameReady,
      delta,
      previousVisible: previous?.visibleQuestions ?? [],
      nextVisible: new Set(next.visibleQuestions),
      primary: primaryRef.current,
    });
  }, [snapshot]);

  // A blocked submit moves focus to the error summary (WCAG 3.3.1); its
  // role="alert" reads the summary heading. Each entry then jumps to its field.
  useEffect(() => {
    if (showMissing && snapshot.flowState.missingRequired.length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [showMissing, snapshot.flowState.missingRequired.length]);

  const focusMissingField = useCallback(
    (questionId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (fieldsRef.current) focusQuestion(fieldsRef.current, questionId);
    },
    [],
  );

  const progress = {
    current: snapshot.progress.stepIndex + 1,
    total: snapshot.progress.totalVisibleSteps,
  };
  const readyToSubmit = snapshot.flowState.readyToSubmit;
  const primaryLabel = readyToSubmit ? t("action.submit") : t("action.continue");
  const missing = showMissing ? snapshot.flowState.missingRequired : [];

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
              {missing.map((questionId) => (
                <li key={questionId}>
                  <a
                    href={`#${questionId}`}
                    onClick={focusMissingField(questionId)}
                    className="text-sm text-(--color-danger-fg) underline"
                  >
                    {t("errorSummary.missingRequired")}
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

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            ref={primaryRef}
            type="button"
            className={buttonClass("primary")}
            onClick={onPrimary}
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
