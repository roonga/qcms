"use client";

import {
  A2UIStepRenderer,
  type A2UIAnswerValue,
  type A2UIStepDocument,
  type A2UIValues,
} from "@roonga/qcms-ui";
import { useCallback, useState } from "react";

import { Button } from "@/components/kit";
import { usePreviewLocale } from "@/components/locale-context";
import { PreviewThemeIsland } from "@/components/preview-theme-island";
import type { FormVersionSnapshot } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { VERSION_HEADING_ID } from "@/lib/page-headings";
import type { PreviewTheme } from "@/lib/preview-theme";

export function VersionView({
  snapshot,
  defaultTheme,
  headingId = VERSION_HEADING_ID,
}: {
  readonly headingId?: string;
  readonly snapshot: FormVersionSnapshot;
  readonly defaultTheme: PreviewTheme;
}) {
  const previewLocale = usePreviewLocale();
  const [answers, setAnswers] = useState<{ key: number; values: A2UIValues }>({
    key: snapshot.version,
    values: {},
  });
  const [stepIndex, setStepIndex] = useState(0);

  if (answers.key !== snapshot.version) {
    setAnswers({ key: snapshot.version, values: {} });
    setStepIndex(0);
  }

  const handleChange = useCallback((name: string, value: A2UIAnswerValue | undefined): void => {
    setAnswers((previous) => {
      const values = { ...previous.values };
      if (value === undefined) delete values[name];
      else values[name] = value;
      return { key: previous.key, values };
    });
  }, []);

  const steps = snapshot.documents;
  const index = steps.length === 0 ? 0 : Math.min(stepIndex, steps.length - 1);
  const step = steps[index];

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4"
      data-testid="qcms-version-view"
    >
      <div className="flex flex-col gap-1">
        <p
          className="qcms-respondent-note text-sm text-(--color-text-muted)"
          data-testid="qcms-version-stored"
        >
          {t("forms.history.stored", { version: snapshot.version })}
        </p>
        <p className="qcms-respondent-note text-sm text-(--color-text-muted)">
          {t("forms.history.readOnly")}
        </p>
        <p className="text-xs text-(--color-text-muted)">
          {t("forms.preview.stamps", {
            compilerVersion: snapshot.compilerVersion,
            a2uiSpecVersion: snapshot.a2uiSpecVersion,
          })}
        </p>
      </div>

      {step === undefined ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.preview.noSteps")}</p>
      ) : (
        <>
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-version-step">
            {t("forms.history.stepOf", {
              index: index + 1,
              total: steps.length,
              title: step.stepId,
            })}
          </p>

          <PreviewThemeIsland defaultTheme={defaultTheme} frameLabel={t("forms.history.frame")}>
            <A2UIStepRenderer
              document={{ stepId: step.stepId, root: step.root as A2UIStepDocument["root"] }}
              values={answers.values}
              onChange={handleChange}
              specVersion={snapshot.a2uiSpecVersion}
              locale={previewLocale}
              headingLevelOffset={1}
            />
          </PreviewThemeIsland>

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
              isDisabled={index >= steps.length - 1}
              onPress={() => {
                setStepIndex(index + 1);
              }}
            >
              {t("forms.preview.next")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
