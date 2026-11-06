"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/kit";
import type { PreviewConditionState } from "@/lib/forms/builder-state";
import { newRule, removeRule, stepPins, upsertRule } from "@/lib/forms/draft";
import { NEW_RULE_HASH } from "@/lib/forms/issues";
import type { DraftForm, DraftRule, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { sectionHeadingId } from "@/lib/page-headings";
import type { ReadState } from "@/lib/read-state";

import { RuleTestBenchPanel } from "./rule-test-bench";
import { RuleWizard } from "./rule-wizard";
import { RulesTable } from "./rules-table";

export function RulesEditor({
  draft,
  library,
  issues,
  previewCondition,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
    instances: Record<string, readonly string[]>;
  }) => Promise<PreviewConditionState>;
  readonly onChange: (next: DraftForm) => void;
}) {
  const firstPinned = draft.steps.flatMap((step) => stepPins(step))[0]?.questionId;
  const [edited, setEdited] = useState<DraftRule | undefined>(undefined);

  const startAdding = (): void => {
    if (firstPinned !== undefined) setEdited(newRule(draft, firstPinned));
  };

  useEffect(() => {
    if (window.location.hash !== NEW_RULE_HASH) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    startAdding();
  }, []);

  return (
    <section aria-labelledby={sectionHeadingId("rules")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="md"
          isDisabled={firstPinned === undefined}
          onPress={startAdding}
        >
          {t("forms.rules.add")}
        </Button>
      </div>

      {firstPinned === undefined && (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.needPin")}</p>
      )}

      {draft.rules.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">{t("forms.rules.empty")}</p>
      ) : (
        <RulesTable
          draft={draft}
          library={library}
          issues={issues}
          onEdit={(ruleId) => {
            setEdited(draft.rules.find((rule) => rule.ruleId === ruleId));
          }}
          onRemove={(ruleId) => {
            onChange(removeRule(draft, ruleId));
          }}
        />
      )}

      <RuleTestBenchPanel
        draft={draft}
        rules={draft.rules}
        library={library}
        previewCondition={previewCondition}
      />

      {/* Key the dialog by rule so React cannot carry the previous rule's unsaved edits into the next one. */}
      {edited !== undefined && (
        <RuleWizard
          key={edited.ruleId}
          draft={draft}
          rule={edited}
          library={library}
          issues={issues}
          previewCondition={previewCondition}
          onSave={(next) => {
            onChange(upsertRule(draft, next));
            setEdited(undefined);
          }}
          onCancel={() => {
            setEdited(undefined);
          }}
        />
      )}
    </section>
  );
}
