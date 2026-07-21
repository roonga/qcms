"use client";

import { A2UIStepRenderer } from "@qcms/ui";
import type { A2UIAnswerValue, A2UIErrors, A2UIStepDocument, A2UIValues } from "@qcms/ui";
import { useCallback, useRef, useState } from "react";

import { PortalShell } from "@/components/portal-shell";
import { t } from "@/lib/i18n/en";
import { buttonClass } from "@/lib/ui";
import { documentForVisible } from "@/lib/visible";
import type { StepResponse } from "@/lib/server/api";

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
  const valuesRef = useRef<A2UIValues>(values);
  valuesRef.current = values;
  // Answer posts are serialized: a follow-up answer must not overtake the answer
  // that made its question visible (else the API rejects it 409 not-visible).
  const queueRef = useRef<Promise<void>>(Promise.resolve());

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
        {failed ? (
          <p role="alert" className="text-sm text-(--color-danger-fg)">
            {t("session.lost.body")}
          </p>
        ) : null}

        {missing.length > 0 ? (
          <div
            role="alert"
            className="rounded-lg border border-(--color-danger) bg-(--color-danger-subtle) p-4"
          >
            <p className="text-sm font-medium text-(--color-danger-fg)">
              {t("errorSummary.title")}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {missing.map((questionId) => (
                <li key={questionId}>
                  <a href={`#${questionId}`} className="text-sm text-(--color-danger-fg) underline">
                    {t("errorSummary.missingRequired")}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {snapshot.step !== null ? (
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
        ) : (
          <p className="text-sm leading-relaxed text-(--color-text-muted)">
            {t("flow.submitReady")}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
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
