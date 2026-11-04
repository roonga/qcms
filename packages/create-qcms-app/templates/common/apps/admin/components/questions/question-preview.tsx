"use client";

import {
  A2UIStepRenderer,
  type A2UIAnswerValue,
  type A2UIStepDocument,
  type A2UIValues,
} from "@roonga/qcms-ui";
import { useCallback, useState } from "react";

import { usePreviewLocale } from "@/components/locale-context";
import { PreviewThemeIsland } from "@/components/preview-theme-island";
import { t } from "@/lib/i18n/en";
import type { PreviewTheme } from "@/lib/preview-theme";
import type { PreviewDocument } from "@/lib/questions/types";

/* Compile draft previews only through the API; the serving path must render immutable stored output
   without recompilation. */
export function QuestionPreview({
  preview,
  resetKey,
  defaultTheme,
}: {
  readonly preview: PreviewDocument;
  readonly defaultTheme: PreviewTheme;
  /* Reset answers by selected version: the preview's stepId stays constant across soft navigation and cannot
     identify a new document. */
  readonly resetKey: string | number;
}) {
  const previewLocale = usePreviewLocale();
  // Compiled roots remain opaque across the wire; only the renderer registry knows their node semantics.
  const document: A2UIStepDocument = {
    stepId: preview.stepId,
    root: preview.root as A2UIStepDocument["root"],
  };

  // Reset during render so the new version never paints a frame containing the previous version's answers.
  const [answers, setAnswers] = useState<{ key: string | number; values: A2UIValues }>({
    key: resetKey,
    values: {},
  });
  if (answers.key !== resetKey) setAnswers({ key: resetKey, values: {} });

  const handleChange = useCallback((name: string, value: A2UIAnswerValue | undefined): void => {
    setAnswers((previous) => {
      const values = { ...previous.values };
      if (value === undefined) delete values[name];
      else values[name] = value;
      return { key: previous.key, values };
    });
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-(--color-text-muted)">{t("questions.preview.note")}</p>
      <PreviewThemeIsland defaultTheme={defaultTheme}>
        <A2UIStepRenderer
          document={document}
          specVersion={preview.a2uiSpecVersion}
          values={answers.values}
          onChange={handleChange}
          // Pass the deployment locale explicitly; the renderer default may differ from the portal's controls.
          locale={previewLocale}
        />
      </PreviewThemeIsland>
    </div>
  );
}
