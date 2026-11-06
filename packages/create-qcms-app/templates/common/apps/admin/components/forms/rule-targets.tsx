"use client";

import { useId, useState, type ReactNode } from "react";

import { FieldHelp } from "@/components/help-tip";
import { Alert, Checkbox, TextField } from "@/components/kit";
import { countTargets, filterTargets, targetGroups } from "@/lib/forms/rule-targets";
import type { TargetStepGroup } from "@/lib/forms/rule-targets";
import type { DraftForm, DraftRule } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

export function RuleTargets({
  draft,
  rule,
  references,
  groupReferences,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  readonly references: readonly string[];
  /* Whole-group reads cut at the group's end; allowing targets inside that span would violate forward-only
     publishing rules. */
  readonly groupReferences: readonly string[];
  readonly onChange: (show: readonly string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);

  const all = targetGroups(draft, references, groupReferences);
  const shown = filterTargets(all, query);
  const total = countTargets(all);
  const visible = countTargets(shown);

  // Compute warnings from the unfiltered grouping; narrowing visible choices must not suppress a rule's
  // warning.
  const eligibleIds = new Set(all.eligible.flatMap((group) => group.options.map((o) => o.id)));
  const backward = rule.show.filter((target) => !eligibleIds.has(target));

  const toggle = (target: string, isSelected: boolean) => {
    onChange(
      isSelected ? [...rule.show, target] : rule.show.filter((candidate) => candidate !== target),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="qcms-fieldset qcms-fieldset--flat">
        <legend className="qcms-fieldset__legend">{t("forms.rule.show")}</legend>

        {total === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("forms.rule.targetsNone")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-(--color-text)" data-testid="qcms-targets-selected">
              {rule.show.length === 0
                ? t("forms.rule.targetsSelectedNone")
                : t("forms.rule.targetsSelected", { targets: rule.show.join(", ") })}
            </p>

            <div className="qcms-targets__filter">
              <FieldHelp help={t("forms.rule.targetsFilterHint")}>
                <TextField
                  label={t("forms.rule.targetsFilter")}
                  value={query}
                  onChange={setQuery}
                />
              </FieldHelp>
              <p
                aria-live="polite"
                className="text-sm text-(--color-text-muted)"
                data-testid="qcms-targets-count"
              >
                {t("forms.rule.targetsShowing", { shown: visible, total })}
              </p>
            </div>

            {visible === 0 ? (
              <p className="text-sm text-(--color-text-muted)">{t("forms.rule.targetsNoMatch")}</p>
            ) : (
              <>
                <TargetEligibilityGroup
                  legend={t("forms.rule.targetsEligible")}
                  groups={shown.eligible}
                  selected={rule.show}
                  onToggle={toggle}
                />
                <TargetEligibilityGroup
                  legend={t("forms.rule.targetsIneligible")}
                  groups={shown.ineligible}
                  selected={rule.show}
                  onToggle={toggle}
                  isIneligible
                  help={
                    <button
                      type="button"
                      className="qcms-help-dot"
                      aria-expanded={helpOpen}
                      aria-controls={helpId}
                      aria-label={t("forms.rule.targetsHelpLabel")}
                      onClick={() => {
                        setHelpOpen((open) => !open);
                      }}
                    >
                      <span aria-hidden="true">{"?"}</span>
                    </button>
                  }
                  helpPanel={
                    helpOpen ? (
                      <p id={helpId} className="text-sm text-(--color-text-muted)">
                        {t("forms.rule.targetsHelpDetail")}
                      </p>
                    ) : null
                  }
                />
              </>
            )}
          </div>
        )}
      </fieldset>

      {backward.length > 0 && (
        <div data-testid="qcms-backward-flag" data-rule-id={rule.ruleId}>
          <Alert variant="warning">
            {t("forms.rule.backwardWarning", { targets: backward.join(", ") })}
          </Alert>
        </div>
      )}
    </div>
  );
}

function TargetEligibilityGroup({
  legend,
  groups,
  selected,
  onToggle,
  help,
  helpPanel,
  isIneligible = false,
}: {
  readonly legend: string;
  readonly groups: readonly TargetStepGroup[];
  readonly selected: readonly string[];
  readonly onToggle: (target: string, isSelected: boolean) => void;
  readonly help?: ReactNode;
  readonly helpPanel?: ReactNode;
  readonly isIneligible?: boolean;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-(--color-text-muted)">{legend}</p>
        {help}
      </div>
      {helpPanel}
      {groups.map((group) => (
        <TargetStep
          key={group.stepId}
          group={group}
          selected={selected}
          onToggle={onToggle}
          isIneligible={isIneligible}
        />
      ))}
    </div>
  );
}

function TargetStep({
  group,
  selected,
  onToggle,
  isIneligible = false,
}: {
  readonly group: TargetStepGroup;
  readonly selected: readonly string[];
  readonly onToggle: (target: string, isSelected: boolean) => void;
  readonly isIneligible?: boolean;
}) {
  return (
    <fieldset className="qcms-targets__step" data-target-step={group.stepId}>
      <legend className="qcms-targets__step-legend">
        {group.title}
        <span className="qcms-question-id qcms-targets__step-id">{group.stepId}</span>
      </legend>
      <div className="flex flex-wrap gap-3">
        {group.options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <Checkbox
              key={option.id}
              label={
                option.kind === "step"
                  ? t("forms.rule.targetStep", { stepId: option.id })
                  : option.label
              }
              isSelected={isSelected}
              isDisabled={isIneligible && !isSelected}
              onChange={(next) => {
                onToggle(option.id, next);
              }}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
