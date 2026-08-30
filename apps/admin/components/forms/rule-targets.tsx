"use client";

import { useId, useState, type ReactNode } from "react";

import { Alert, Checkbox, TextField } from "@/components/kit";
import { countTargets, filterTargets, targetGroups } from "@/lib/forms/rule-targets";
import type { TargetStepGroup } from "@/lib/forms/rule-targets";
import type { DraftForm, DraftRule } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The "Then show" phase: one rule's `show` list, grouped by step and narrowable.
 *
 * ## The scale this is drawn for
 *
 * The Code Owner's stated case is an insurance organisation with ten or more steps and
 * hundreds of questions. A flat wrap of two hundred checkboxes under one legend is not a
 * control at that size, it is a wall, so this does the two things that make a long list
 * usable and nothing else: it groups by the structure the author already has in their
 * head (the step), and it lets them type. `lib/forms/rule-targets.ts` owns both, because
 * both are decisions about what an author sees rather than about markup, and it tests them
 * against a ten-step, two-hundred-question form.
 *
 * ## Checkboxes, still
 *
 * `show` is a set, the kit has no multi-select (ADR-22 forbids adding one here), and a
 * group whose every member shows its own state is what a keyboard user can work through
 * without a popup. That is the same call the operand's option set makes and the grouping
 * does not change it.
 *
 * ## The selected set is stated above the filter, and that is not decoration
 *
 * A filter that narrows a TICKED target out of view is the trap `library-picker.tsx`
 * already met and answered with its chosen pane: "a search that filters a chosen row out
 * of the table must not make the choice invisible". The same answer here, in the smaller
 * shape this list needs - a line naming everything currently in `show`, rendered before
 * the filter and never subject to it. Without it an author can type four characters and
 * be looking at a rule whose targets they can no longer see.
 *
 * ## The `?` explains the ordering rule, and it does not move when pressed
 *
 * Why some targets sit under "comes before this condition" is ADR-16 in a paragraph, and a
 * standing paragraph that never changes is exactly what `public-form-link.tsx` puts behind
 * a `?`: a real button with `aria-expanded` and `aria-controls`, rendered in flow, not a
 * tooltip (out of reach of touch, keyboard and a screen reader) and not absolutely
 * positioned (a floated panel inside a scrolling column is the clipped popover this app
 * has already fixed once).
 *
 * The disclosure renders BELOW the row rather than inside it, and the row is anchored to
 * its start. `components/save-model.tsx` records the trap that makes both necessary:
 * revealing content inside a row anchored to its end pushes the control out from under
 * the pointer that is pressing it. Here nothing in the row changes size when the paragraph
 * appears, so the `?` is in the same place for the second press as for the first.
 */
export function RuleTargets({
  draft,
  rule,
  references,
  onChange,
}: {
  readonly draft: DraftForm;
  readonly rule: DraftRule;
  /** What the condition reads, computed once by the wizard and shared by its phases. */
  readonly references: readonly string[];
  readonly onChange: (show: readonly string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);

  const all = targetGroups(draft, references);
  const shown = filterTargets(all, query);
  const total = countTargets(all);
  const visible = countTargets(shown);

  // A ticked target that is not in the eligible group is a backward one. Read off the
  // UNFILTERED grouping rather than recomputed: the flag is a statement about the rule,
  // not about what the author has typed into the filter, so narrowing the list must never
  // narrow the warning.
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
            {/* WHAT IS CHOSEN, before anything that could hide it. */}
            <p className="text-sm text-(--color-text)" data-testid="qcms-targets-selected">
              {rule.show.length === 0
                ? t("forms.rule.targetsSelectedNone")
                : t("forms.rule.targetsSelected", { targets: rule.show.join(", ") })}
            </p>

            <div className="qcms-targets__filter">
              <TextField
                label={t("forms.rule.targetsFilter")}
                description={t("forms.rule.targetsFilterHint")}
                value={query}
                onChange={setQuery}
              />
              {/* The count is a live region because narrowing a list is a change a reader
                  who cannot see it has no other way of noticing: they type, and the thing
                  that happened is that two hundred targets became four. */}
              <p
                aria-live="polite"
                className="text-sm text-(--color-text-muted)"
                data-testid="qcms-targets-count"
              >
                {t("forms.rule.targetsShowing", { shown: visible, total })}
              </p>
            </div>

            {visible === 0 ? (
              // `plan/admin-design-contracts.md` §3's FILTERED empty state: it says the
              // filter is what emptied the list, and the control that clears it is the
              // field directly above. No call to action, because there is nothing to do
              // here that the author cannot already see how to undo.
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

/** One eligibility group: its heading, and the step groups underneath it. */
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
      {/* ANCHORED TO ITS START, with the `?` after the label rather than pushed to the far
          end of the row. Nothing in this row grows or shrinks when the paragraph below
          appears, which is what keeps the control under the pointer that pressed it. */}
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

/**
 * One step's targets, under the step's own name.
 *
 * A nested `fieldset` rather than a heading, because this is a group of CONTROLS and its
 * legend is what a screen reader announces with each checkbox inside it: "Section 3,
 * q_s3_q4, checkbox". A heading would put the step's name in the outline of a dialog whose
 * subject is a rule, and would not be announced with the control at all.
 */
function TargetStep({
  group,
  selected,
  onToggle,
  isIneligible = false,
}: {
  readonly group: TargetStepGroup;
  readonly selected: readonly string[];
  readonly onToggle: (target: string, isSelected: boolean) => void;
  /** Whether this group is the one nothing new may be chosen from. */
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
              // NOT CHOOSABLE, BUT ALWAYS CLEARABLE (Code Owner, 2026-08-30).
              //
              // The group used to render exactly like the eligible one, so a list of
              // things this rule CANNOT show looked like a list of things it could, and
              // the only correction came after the press. It is disabled now.
              //
              // The exception is the whole of the correctness here: a target that is
              // already selected stays live. An ineligible target is not only reached by
              // choosing one - the far more common route is that the CONDITION moved
              // under a target that was legal when it was picked, by coming to read a
              // question further down the form. Disabling that checkbox would leave the
              // author looking at the reason their form will not publish with no control
              // to act on it, and the only way out would be to delete the rule.
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
