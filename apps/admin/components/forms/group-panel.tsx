"use client";

import { useRef, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { EntityId } from "@/components/entity-id";
import { FieldHelp, HelpTip } from "@/components/help-tip";
import { Alert, Button, Select, TextField } from "@/components/kit";
import { messageForIssue } from "@/lib/forms/issues";
import { stepGridRows, type PinRowAction, type PinRowView } from "@/lib/forms/pin-grid";
import {
  REPEAT_COUNT_SOURCES,
  REPEAT_PRESENTATIONS,
  type DraftForm,
  type DraftGroup,
  type DraftPin,
  type DraftRepeatCount,
  type DraftStep,
  type FormIssue,
  type PinnableQuestion,
  type RepeatCountSource,
  type RepeatPresentation,
} from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";
import type { ReadState } from "@/lib/read-state";

import { LibraryPicker } from "./library-picker";
import { OwnershipGrid } from "./ownership-grid";
import { TableColumnView } from "./table-column-view";

export function GroupPanel({
  draft,
  step,
  group,
  library,
  issues,
  saveFlash,
  onRename,
  onInstanceLabel,
  onCount,
  onPresentation,
  onAddPins,
  onMovePin,
  onRemovePin,
  onReorderPin,
}: {
  readonly draft: DraftForm;
  readonly step: DraftStep;
  readonly group: DraftGroup;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly issues: readonly FormIssue[] | undefined;
  readonly saveFlash?: ReactNode;
  readonly onRename: (label: string) => void;
  readonly onInstanceLabel: (template: string) => void;
  readonly onCount: (count: DraftRepeatCount) => void;
  readonly onPresentation: (presentation: RepeatPresentation) => void;
  readonly onAddPins: (pins: readonly DraftPin[], index: number) => void;
  readonly onMovePin: (questionId: string, version: number) => void;
  readonly onRemovePin: (questionId: string) => void;
  readonly onReorderPin: (questionId: string, delta: -1 | 1) => void;
}) {
  const [pickerAt, setPickerAt] = useState<number | undefined>(undefined);
  const addRef = useRef<HTMLDivElement>(null);

  const label = textOf(group.label, draft.defaultLocale);
  const name = label === "" ? t("forms.group.untitled") : label;
  const rows = stepGridRows(
    { stepId: step.stepId, title: step.title, items: [group] },
    library,
    issues,
  ).filter((row) => row.kind === "pin");
  const groupIssues = (issues ?? []).filter(
    (issue) => issue.path?.group === group.groupId && issue.path?.rule === undefined,
  );

  function runPinAction(row: PinRowView, action: PinRowAction): void {
    if (action === "remove") {
      onRemovePin(row.questionId);
      return;
    }
    if (action === "moveUp" || action === "moveDown") {
      onReorderPin(row.questionId, action === "moveUp" ? -1 : 1);
      return;
    }
    setPickerAt(action === "insertAbove" ? row.position - 1 : row.position);
  }

  return (
    <section
      aria-labelledby="qcms-group-heading"
      data-testid="qcms-group-panel"
      data-group-id={group.groupId}
      className="flex flex-col gap-4 rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="qcms-group-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.group.heading", { label: name })}
        </h1>
        <HelpTip>{t("forms.group.note")}</HelpTip>
        {saveFlash}
      </div>

      {groupIssues.length > 0 && (
        <ul aria-label={t("forms.group.issues")} className="flex flex-col gap-1">
          {groupIssues.map((issue, index) => (
            <li
              key={`${issue.code}:${String(index)}`}
              className="text-sm text-(--color-danger-fg)"
              data-issue-code={issue.code}
            >
              {messageForIssue(issue, draft)}
            </li>
          ))}
        </ul>
      )}

      {/* Group ids are minted once and remain stable across renames because conditions reference them. */}
      <FieldHelp help={t("forms.group.nameHint")}>
        <TextField label={t("forms.group.name")} value={label} onChange={onRename} />
      </FieldHelp>
      <p className="text-sm text-(--color-text-muted)">
        <span className="me-2">{t("forms.group.idLabel")}</span>
        <EntityId kind="group" value={group.groupId} copy />
      </p>

      <section aria-labelledby="qcms-group-members" className="flex flex-col gap-3">
        <h2 id="qcms-group-members" className="text-sm font-semibold text-(--color-text)">
          {t("forms.group.members")}
        </h2>
        {rows.length > 0 ? (
          <OwnershipGrid
            caption={t("forms.group.members")}
            rows={rows}
            draft={draft}
            onPinAction={runPinAction}
            onMovePin={onMovePin}
            onFocusAdd={() => {
              addRef.current?.querySelector<HTMLElement>("button")?.focus();
            }}
          />
        ) : (
          <EmptyState
            heading={t("forms.group.membersEmpty")}
            body={t("forms.group.membersEmptyBody")}
            testId="qcms-group-empty"
          />
        )}
        <div ref={addRef}>
          <Button
            variant="secondary"
            size="md"
            onPress={() => {
              setPickerAt(group.items.length);
            }}
          >
            {t("forms.group.addQuestion")}
          </Button>
        </div>
      </section>

      <CountFields draft={draft} step={step} group={group} library={library} onCount={onCount} />

      <InstanceLabelField group={group} draft={draft} onChange={onInstanceLabel} />

      <ChoiceGroup
        name={`presentation-${group.groupId}`}
        legend={t("forms.group.presentationLegend")}
        value={group.presentation}
        options={REPEAT_PRESENTATIONS.map((presentation) => ({
          value: presentation,
          label: t(`forms.group.presentation.${presentation}`),
          description: t(`forms.group.presentation.${presentation}Hint`),
        }))}
        onChange={onPresentation}
      />

      {group.presentation === "table" && (
        <TableColumnView
          members={group.items}
          library={library.ok ? library.data : []}
          onAddColumn={() => {
            setPickerAt(group.items.length);
          }}
        />
      )}

      {pickerAt !== undefined && (
        <LibraryPicker
          isOpen
          stepTitle={name}
          draft={draft}
          library={library}
          columnTypesOnly={group.presentation === "table"}
          onAddPins={(pins) => {
            onAddPins(pins, pickerAt);
          }}
          onClose={() => {
            setPickerAt(undefined);
          }}
        />
      )}
    </section>
  );
}

/* Use text fields for optional numeric bounds: the kit NumberField cannot express an unset value. */
function CountFields({
  draft,
  step,
  group,
  library,
  onCount,
}: {
  readonly draft: DraftForm;
  readonly step: DraftStep;
  readonly group: DraftGroup;
  readonly library: ReadState<readonly PinnableQuestion[]>;
  readonly onCount: (count: DraftRepeatCount) => void;
}) {
  const count = group.count;
  const candidates = countQuestions(draft, step, group, library);

  return (
    <section aria-labelledby="qcms-group-count" className="flex flex-col gap-3">
      <h2 id="qcms-group-count" className="qcms-visually-hidden">
        {t("forms.group.countLegend")}
      </h2>
      <ChoiceGroup
        name={`count-${group.groupId}`}
        legend={t("forms.group.countLegend")}
        value={count.source}
        options={REPEAT_COUNT_SOURCES.map((source) => ({
          value: source,
          label: t(`forms.group.count.${source}`),
          description: t(`forms.group.count.${source}Hint`),
        }))}
        onChange={(next) => {
          onCount(countForSource(next, count, candidates[0]));
        }}
      />

      {count.source === "fixed" ? (
        <TextField
          label={t("forms.group.fixedCount")}
          value={String(count.count)}
          inputMode="numeric"
          onChange={(next) => {
            onCount({ source: "fixed", count: Math.max(1, wholeNumber(next, count.count)) });
          }}
        />
      ) : (
        <>
          {count.source === "fromAnswer" &&
            (candidates.length === 0 ? (
              <Alert variant="info">{t("forms.group.countQuestionNone")}</Alert>
            ) : (
              <Select
                label={t("forms.group.countQuestion")}
                value={count.questionId}
                items={candidates.map((questionId) => ({ label: questionId, value: questionId }))}
                onChange={(next) => {
                  onCount({ ...count, questionId: next });
                }}
              />
            ))}
          <TextField
            label={t("forms.group.min")}
            value={String(count.min)}
            inputMode="numeric"
            onChange={(next) => {
              onCount({ ...count, min: Math.max(0, wholeNumber(next, count.min)) });
            }}
          />
          <TextField
            label={t("forms.group.max")}
            isRequired
            value={count.max === undefined ? "" : String(count.max)}
            inputMode="numeric"
            onChange={(next) => {
              // Omit an unset maximum; storing zero would invent a bound and make every instance count invalid.
              const trimmed = next.trim();
              if (trimmed === "") {
                onCount(
                  count.source === "open"
                    ? { source: "open", min: count.min }
                    : { source: "fromAnswer", questionId: count.questionId, min: count.min },
                );
                return;
              }
              onCount({ ...count, max: Math.max(1, wholeNumber(trimmed, count.max ?? 1)) });
            }}
          />
          {count.max === undefined && (
            <Alert variant="warning">
              <span data-testid="qcms-group-max-missing">{t("forms.group.maxMissing")}</span>
            </Alert>
          )}
        </>
      )}
    </section>
  );
}

function InstanceLabelField({
  group,
  draft,
  onChange,
}: {
  readonly group: DraftGroup;
  readonly draft: DraftForm;
  readonly onChange: (template: string) => void;
}) {
  const template = textOf(group.instanceLabel, draft.defaultLocale);
  const preview = template.replaceAll("{n}", "1");
  return (
    <div className="flex flex-col gap-2">
      <FieldHelp help={t("forms.group.instanceLabelHint")}>
        <TextField label={t("forms.group.instanceLabel")} value={template} onChange={onChange} />
      </FieldHelp>
      <p className="text-sm text-(--color-text-muted)" data-testid="qcms-group-label-preview">
        <span className="me-2">{t("forms.group.instanceLabelPreview")}</span>
        {preview === "" ? (
          t("forms.group.instanceLabelPreviewEmpty")
        ) : (
          <strong className="font-semibold text-(--color-text)">{preview}</strong>
        )}
      </p>
    </div>
  );
}

/* Count sources must be outside groups and strictly before this group's span to avoid per-instance
   ambiguity and backward references. */
function countQuestions(
  draft: DraftForm,
  step: DraftStep,
  group: DraftGroup,
  library: ReadState<readonly PinnableQuestion[]>,
): readonly string[] {
  const before: { readonly questionId: string; readonly version: number }[] = [];
  for (const candidate of draft.steps) {
    if (candidate.stepId === step.stepId) break;
    for (const pin of candidate.items) {
      if (!("groupId" in pin)) before.push(pin);
    }
  }
  for (const item of step.items) {
    if ("groupId" in item && item.groupId === group.groupId) break;
    if (!("groupId" in item)) before.push(item);
  }
  if (!library.ok) return before.map((pin) => pin.questionId);
  return before
    .filter((pin) => {
      const question = library.data.find((entry) => entry.questionId === pin.questionId);
      const version = question?.versions.find((entry) => entry.version === pin.version);
      return version?.definition.type === "number";
    })
    .map((pin) => pin.questionId);
}

function countForSource(
  source: RepeatCountSource,
  previous: DraftRepeatCount,
  firstCandidate: string | undefined,
): DraftRepeatCount {
  if (source === "fixed") {
    return {
      source: "fixed",
      count: Math.max(1, previous.source === "fixed" ? previous.count : previous.min),
    };
  }
  const min = previous.source === "fixed" ? previous.count : previous.min;
  const max = previous.source === "fixed" ? undefined : previous.max;
  const bounds = { min, ...(max === undefined ? {} : { max }) };
  if (source === "open") return { source: "open", ...bounds };
  return {
    source: "fromAnswer",
    questionId: previous.source === "fromAnswer" ? previous.questionId : (firstCandidate ?? ""),
    ...bounds,
  };
}

function wholeNumber(text: string, fallback: number): number {
  const parsed = Number.parseInt(text.trim(), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function ChoiceGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    readonly description: string;
  }[];
  readonly value: T;
  readonly onChange: (next: T) => void;
}) {
  return (
    <fieldset className="qcms-choice" data-choice={name}>
      <legend className="qcms-choice__legend">{legend}</legend>
      {options.map((option) => {
        const hintId = `${name}-${option.value}-hint`;
        return (
          <div key={option.value} className="qcms-choice__option" data-value={option.value}>
            <label className="qcms-choice__row">
              <input
                type="radio"
                className="qcms-choice__input"
                name={name}
                value={option.value}
                checked={option.value === value}
                aria-describedby={hintId}
                onChange={() => {
                  onChange(option.value);
                }}
              />
              <span className="qcms-choice__label">{option.label}</span>
            </label>
            <span id={hintId} className="qcms-choice__hint">
              {option.description}
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}
