"use client";

import { useState } from "react";

import { Alert, Button, Dialog, Tab, TabList, TabPanel, Tabs } from "@/components/kit";
import { conditionGroupReferences, conditionReferences } from "@/lib/forms/condition";
import { upsertRule } from "@/lib/forms/draft";
import { issuesForRule, messageForIssue } from "@/lib/forms/issues";
import { ruleScope, scopeChipLabel } from "@/lib/forms/rule-targets";
import type { PreviewConditionState } from "@/lib/forms/builder-state";
import type { DraftForm, DraftRule, FormIssue, PinnableQuestion } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import type { ReadState } from "@/lib/read-state";

import { ConditionEditor } from "./condition-editor";
import { RuleTargets } from "./rule-targets";
import { RuleTestBench } from "./rule-test-bench";

/* Keep focus in the tablist when selecting a phase so arrow-key browsing can continue; modal close
   restores the trigger. */
export function RuleWizard({
  draft,
  rule,
  library,
  issues,
  previewCondition,
  onSave,
  onCancel,
}: {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[];
  readonly previewCondition: (input: {
    draft: DraftForm;
    ruleId: string;
    answers: Record<string, unknown>;
    instances: Record<string, readonly string[]>;
  }) => Promise<PreviewConditionState>;
  readonly onSave: (rule: DraftRule) => void;
  readonly onCancel: () => void;
}) {
  // Seed local dialog state once; syncing every parent prop update would overwrite edits before Save.
  const [edited, setEdited] = useState<DraftRule>(rule);
  const [phase, setPhase] = useState<Phase>("when");

  const references = conditionReferences(edited.when);
  const groupReferences = conditionGroupReferences(edited.when);
  // Build targets and bench inputs from the staged rule so they do not describe its older stored condition.
  const working = upsertRule(draft, edited);
  const ruleIssues = issuesForRule(issues, edited.ruleId);
  const scope = ruleScope(working, edited.show);

  return (
    <Dialog
      isOpen
      title={t("forms.rules.editTitle", { ruleId: edited.ruleId })}
      // Route Escape through Cancel as well; a modal must remain escapable.
      isDismissable={false}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onCancel();
      }}
    >
      {/* Keep the rule anchor on the table row only; duplicating its id inside the open dialog would make issue
   links ambiguous. */}
      <section
        className="qcms-rule-wizard"
        data-rule-id={edited.ruleId}
        data-qcms-dialog="wide"
        aria-label={t("forms.rule.heading", { ruleId: edited.ruleId })}
      >
        <Tabs
          selectedKey={phase}
          onSelectionChange={(key) => {
            setPhase(key as Phase);
          }}
          className="qcms-rule-wizard__tabs"
        >
          <TabList aria-label={t("forms.rules.phases")} className="qcms-phasetabs">
            {PHASES.map((candidate) => (
              <Tab key={candidate} id={candidate} className="qcms-phasetab">
                {phaseLabel(candidate)}
              </Tab>
            ))}
          </TabList>

          <TabPanel id="when" className="qcms-rule-wizard__panel">
            <ConditionEditor draft={working} rule={edited} library={library} onChange={setEdited} />
          </TabPanel>

          <TabPanel id="then" className="qcms-rule-wizard__panel">
            <RuleTargets
              draft={working}
              rule={edited}
              references={references}
              groupReferences={groupReferences}
              onChange={(show) => {
                setEdited((current) => ({ ...current, show }));
              }}
            />
          </TabPanel>

          <TabPanel id="test" className="qcms-rule-wizard__panel">
            <RuleTestBench
              draft={working}
              rule={edited}
              library={library}
              previewCondition={previewCondition}
            />
          </TabPanel>
        </Tabs>

        {/* Show stored-rule findings outside the phases so switching tabs cannot hide the reason publishing would
   refuse the rule. */}
        {scope.kind === "group" && (
          <p className="qcms-rule-scope" data-testid="qcms-rule-scope">
            <span className="qcms-tag qcms-tag--draft">{scopeChipLabel(scope)}</span>
            <span className="ms-2 text-sm text-(--color-text-muted)">
              {t("forms.rule.scopeNote", { group: scope.label, noun: scope.noun })}
            </span>
          </p>
        )}
        {scope.kind === "spanning" && (
          <div data-testid="qcms-rule-scope-spanning">
            <Alert variant="warning">{t("forms.rule.scopeSpanning")}</Alert>
          </div>
        )}

        {ruleIssues.length > 0 && (
          <ul aria-label={t("forms.rule.issues")} className="flex flex-col gap-1">
            {ruleIssues.map((issue, index) => (
              <li
                key={`${issue.code}:${String(index)}`}
                className="text-sm text-(--color-danger-fg)"
                data-issue-code={issue.code}
              >
                {messageForIssue(issue)}
              </li>
            ))}
          </ul>
        )}

        <div className="qcms-rule-wizard__footer">
          <div className="qcms-rule-wizard__actions">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="md"
                onPress={() => {
                  onSave(edited);
                }}
              >
                {t("forms.rules.save")}
              </Button>
              <Button variant="secondary" size="md" onPress={onCancel}>
                {t("forms.rules.cancel")}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                isDisabled={previousPhase(phase) === undefined}
                aria-label={t("forms.rules.phaseBackTo", {
                  phase: phaseLabel(previousPhase(phase) ?? phase),
                })}
                onPress={() => {
                  const target = previousPhase(phase);
                  if (target !== undefined) setPhase(target);
                }}
              >
                {t("forms.rules.phaseBack")}
              </Button>
              <Button
                variant="secondary"
                size="md"
                isDisabled={nextPhase(phase) === undefined}
                aria-label={t("forms.rules.phaseNextTo", {
                  phase: phaseLabel(nextPhase(phase) ?? phase),
                })}
                onPress={() => {
                  const target = nextPhase(phase);
                  if (target !== undefined) setPhase(target);
                }}
              >
                {t("forms.rules.phaseNext")}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </Dialog>
  );
}

type Phase = "when" | "then" | "test";

const PHASES: readonly Phase[] = ["when", "then", "test"];

function previousPhase(phase: Phase): Phase | undefined {
  return PHASES[PHASES.indexOf(phase) - 1];
}

function nextPhase(phase: Phase): Phase | undefined {
  return PHASES[PHASES.indexOf(phase) + 1];
}

function phaseLabel(phase: Phase): string {
  if (phase === "when") return t("forms.rules.phaseWhen");
  if (phase === "then") return t("forms.rules.phaseThen");
  return t("forms.rules.phaseTest");
}
