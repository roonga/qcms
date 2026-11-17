"use client";

import { Button } from "@/components/kit";
import { publishSelection, useBuilderFacts } from "@/lib/agent/builder-facts-store";
import { t } from "@/lib/i18n/en";

/** The question picked in the preview's inspect mode, which the next builder turn is about. */
export function SelectedQuestion() {
  const { selection, selectionLabel } = useBuilderFacts();
  if (selection === undefined) return null;
  return (
    <section
      className="qcms-builder-selection"
      aria-labelledby="qcms-builder-selection-heading"
      data-testid="qcms-builder-selection"
      data-qcms-fact={JSON.stringify(selection)}
    >
      <h3 id="qcms-builder-selection-heading" className="qcms-builder-selection__heading">
        {t("builder.selection.heading")}
      </h3>
      <p>
        {t("builder.selection.question", {
          label: selectionLabel,
          questionId: selection.questionId,
        })}
      </p>
      <div>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            publishSelection(undefined);
          }}
        >
          {t("builder.selection.clear")}
        </Button>
      </div>
    </section>
  );
}
