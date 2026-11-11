"use client";

import {
  A2UIStepRenderer,
  documentForVisible,
  type A2UIAnswerValue,
  type A2UIStepDocument,
  type A2UIValues,
} from "@roonga/qcms-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HelpTip } from "@/components/help-tip";
import { Alert, Button, NumberField } from "@/components/kit";
import { usePreviewLocale } from "@/components/locale-context";
import { IssueEntry } from "@/components/forms/validation-panel";
import { PreviewThemeIsland } from "@/components/preview-theme-island";
import {
  previewInstanceLabel,
  previewViewNarrowing,
  previewViews,
} from "@/lib/forms/preview-views";
import type { DraftPreviewState } from "@/lib/forms/builder-state";
import { IDLE_DRAFT_PREVIEW, PREVIEW_INSTANCE_CAP } from "@/lib/forms/builder-state";
import { countBounds, draftGroups, questionGroupIds, stepPins } from "@/lib/forms/draft";
import type { DraftForm, DraftGroup } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";
import { unexpected } from "@/lib/ops/unexpected";
import type { PreviewTheme } from "@/lib/preview-theme";

const DEBOUNCE_MS = 250;

export function DraftPreview({
  draft,
  preview,
  defaultTheme,
}: {
  readonly draft: DraftForm | null;
  readonly defaultTheme: PreviewTheme;
  readonly preview: (input: {
    readonly draft: DraftForm;
    readonly answers: Readonly<Record<string, unknown>>;
    readonly instances: Readonly<Record<string, readonly string[]>>;
  }) => Promise<DraftPreviewState>;
}) {
  const previewLocale = usePreviewLocale();
  const [answers, setAnswers] = useState<A2UIValues>({});
  const [state, setState] = useState<DraftPreviewState>(IDLE_DRAFT_PREVIEW);
  const [stepIndex, setStepIndex] = useState(0);
  /* Mint hypothetical instance ids before the request because the same request's answer keys already
     reference them. */
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});

  const groups = useMemo(() => (draft === null ? [] : draftGroups(draft)), [draft]);
  const instances = useMemo(() => previewRoster(groups, counts), [groups, counts]);

  // Ignore stale responses: an earlier slow request must not overwrite the branch state for newer answers.
  const requestId = useRef(0);

  useEffect(() => {
    if (draft === null) return undefined;
    const id = requestId.current + 1;
    requestId.current = id;
    const timer = setTimeout(() => {
      setState((current) =>
        current.status === "ok" ? current : { ...current, status: "loading" },
      );
      void preview({ draft, answers, instances })
        .then((next) => {
          if (requestId.current === id) setState(next);
        })
        .catch(() => {
          if (requestId.current === id) setState({ status: "error", message: unexpected() });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, answers, instances, preview]);

  const handleChange = useCallback((name: string, value: A2UIAnswerValue | undefined): void => {
    setAnswers((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setAnswers({});
    setStepIndex(0);
    setCounts({});
  }, []);

  const views = useMemo(
    () => previewViews(state.preview?.documents ?? [], state.preview?.flow),
    [state.preview],
  );

  const index = views.length === 0 ? 0 : Math.min(stepIndex, views.length - 1);
  const step = views[index]?.step;
  const served = useMemo(() => rosterRecord(state.preview?.flow.rosters ?? []), [state.preview]);
  const view = previewViewNarrowing(draft, views[index], served);
  const instanceLabel = previewInstanceLabel(draft, served, view);

  return (
    <section
      aria-labelledby="qcms-preview-heading"
      className="flex flex-col gap-4"
      data-testid="qcms-draft-preview"
    >
      <div className="flex flex-col gap-1">
        <div className="qcms-help-head">
          <h2 id="qcms-preview-heading" className="text-lg font-semibold text-(--color-text)">
            {t("forms.preview.heading")}
          </h2>
          <HelpTip>{t("forms.preview.explain")}</HelpTip>
        </div>
        <p className="qcms-preview-banner" data-testid="qcms-preview-banner">
          {t("forms.preview.banner")}
        </p>
      </div>

      {draft === null && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.preview.noSteps")}</p>
      )}

      <div aria-live="polite" className="flex flex-col gap-2" data-testid="qcms-preview-status">
        {state.status === "rejected" && draft !== null && (
          <p className="qcms-visually-hidden">
            {tPlural(
              "forms.preview.unavailableAnnounce.one",
              "forms.preview.unavailableAnnounce.other",
              (state.issues ?? []).length,
            )}
          </p>
        )}
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
          <div className="qcms-help-head">
            <h3
              id="qcms-preview-rejected-heading"
              className="text-base font-semibold text-(--color-text)"
            >
              {t("forms.preview.unavailable")}
            </h3>
            <HelpTip>{t("forms.preview.unavailableHint")}</HelpTip>
          </div>
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
            {instanceLabel === undefined
              ? t("forms.preview.stepOf", {
                  index: index + 1,
                  total: views.length,
                  title: stepTitle(draft, step.stepId),
                })
              : t("forms.preview.stepOfInstance", {
                  index: index + 1,
                  total: views.length,
                  title: stepTitle(draft, step.stepId),
                  instance: instanceLabel,
                })}
          </p>

          <PreviewThemeIsland defaultTheme={defaultTheme} frameLabel={t("forms.preview.frame")}>
            <A2UIStepRenderer
              document={documentForVisible(
                { stepId: step.stepId, root: step.root as A2UIStepDocument["root"] },
                state.preview.flow.visibleQuestions,
              )}
              values={answers}
              onChange={handleChange}
              specVersion={state.preview.a2uiSpecVersion}
              repeat={{
                rosters: served,
                ...(view !== undefined ? { view } : {}),
                visible: new Set(state.preview.flow.visibleQuestions),
              }}
              // Pass the deployment locale explicitly; the renderer's default may differ from the portal's controls.
              locale={previewLocale}
              headingLevelOffset={1}
            />
            {!hasVisibleQuestion(
              draft,
              step.stepId,
              state.preview.flow.visibleQuestions,
              view === undefined ? served : { ...served, [view.groupId]: [view.instanceId] },
            ) && (
              <p className="text-sm text-(--color-text-muted)" data-testid="qcms-preview-empty">
                {t("forms.preview.emptyStep")}
              </p>
            )}
          </PreviewThemeIsland>

          {state.preview.flow.complete && (
            <p className="text-sm text-(--color-text-muted)" data-testid="qcms-preview-complete">
              {t("forms.preview.complete")}
            </p>
          )}

          {groups.length > 0 && (
            <div className="flex flex-wrap items-end gap-3" data-testid="qcms-preview-instances">
              {groups.map((group) => (
                <NumberField
                  key={group.groupId}
                  label={t("forms.preview.instances", {
                    group: groupDisplayName(group, draft),
                  })}
                  value={counts[group.groupId] ?? countBounds(group.count).min}
                  minValue={0}
                  /* Bound roster counts before allocation so a typed huge number cannot exhaust the browser before the API
                     truncates it. */
                  maxValue={countBounds(group.count).max ?? PREVIEW_INSTANCE_CAP}
                  onChange={(next) => {
                    setCounts((current) => ({
                      ...current,
                      [group.groupId]: Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0,
                    }));
                  }}
                />
              ))}
            </div>
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
              isDisabled={index >= views.length - 1}
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

/* Read headings from the draft; compiled nodes are opaque and belong to the renderer. */
function stepTitle(draft: DraftForm | null, stepId: string): string {
  const step = draft?.steps.find((candidate) => candidate.stepId === stepId);
  const title = step?.title[draft?.defaultLocale ?? ""];
  return title === undefined || title === "" ? stepId : title;
}

/* Positional ids are safe only for these unstored hypotheses; real session instance ids must never be
   renumbered or reused. */
function previewRoster(
  groups: readonly DraftGroup[],
  counts: Readonly<Record<string, number>>,
): Readonly<Record<string, readonly string[]>> {
  const rosters: Record<string, readonly string[]> = {};
  for (const group of groups) {
    const asked = counts[group.groupId] ?? countBounds(group.count).min;
    const ceiling = countBounds(group.count).max ?? PREVIEW_INSTANCE_CAP;
    rosters[group.groupId] = Array.from(
      { length: Math.min(Math.max(0, asked), ceiling) },
      (_entry, at) => `ins_p${String(at + 1)}`,
    );
  }
  return rosters;
}

function rosterRecord(
  rosters: readonly { readonly groupId: string; readonly instances: readonly string[] }[],
): Readonly<Record<string, readonly string[]>> {
  const record: Record<string, readonly string[]> = {};
  for (const entry of rosters) record[entry.groupId] = entry.instances;
  return record;
}

function groupDisplayName(group: DraftGroup, draft: DraftForm | null): string {
  const label = group.label[draft?.defaultLocale ?? ""] ?? Object.values(group.label)[0] ?? "";
  return label === "" ? group.groupId : label;
}

function hasVisibleQuestion(
  draft: DraftForm | null,
  stepId: string,
  visibleQuestions: readonly string[],
  rosters: Readonly<Record<string, readonly string[]>>,
): boolean {
  const step = draft?.steps.find((candidate) => candidate.stepId === stepId);
  if (step === undefined) return true;
  // Visibility for group members is instance-qualified; the same question can be visible in one instance and
  // hidden in another.
  const visible = new Set(visibleQuestions);
  const groupOf = draft === null ? new Map<string, string>() : questionGroupIds(draft);
  return stepPins(step).some((pin) => {
    const groupId = groupOf.get(pin.questionId);
    if (groupId === undefined) return visible.has(pin.questionId);
    return (rosters[groupId] ?? []).some((instanceId) =>
      visible.has(`${instanceId}/${pin.questionId}`),
    );
  });
}
