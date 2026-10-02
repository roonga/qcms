"use client";

import { useRef, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { EntityId } from "@/components/entity-id";
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

/**
 * One repeating group's settings (task 074; ADR-42; `plan/repeating-groups-and-table-input.md`
 * §6.2).
 *
 * ## The order of the panel is the order of the decisions
 *
 * §6.2 fixes it, and it is the order an author actually works in rather than the order the
 * schema declares: name and id; the member questions; where the instance count comes from;
 * the bounds; the instance heading with a live preview; and the presentation last, because it
 * is the only field that changes nothing about what is asked.
 *
 * ## A panel, not a route (`plan/admin-design-contracts.md` §7)
 *
 * The rail may carry actions and same-page panel switches since 2026-08-25, and this is one:
 * the builder's rail nests a group under the step that holds it, and choosing it switches the
 * column beside the rail. A route would make a fourth place a draft is edited, with a fourth
 * save model, for six fields - the "step per route" shape `plan/admin-ux-audit.md` §3.5
 * records as the POC's scope bug. The admin requires JavaScript (PR #1000), so there is no
 * no-JS path to keep for either choice.
 *
 * ## `max` is a REQUIRED field and the panel says so here
 *
 * Q4 as amended by Q14 (ruled 2026-09-29): the Code Owner removed every installation-wide
 * instance ceiling, so a group's own `max` is the only bound that exists on how many instances
 * a respondent may create - which makes it a security-relevant declaration (SEC-16) rather
 * than a nicety. The field is marked required where the author sets it and the grid's boundary
 * row flags a group that has none, rather than leaving `REPEAT_MAX_MISSING` to arrive at
 * publish. **A `fixed` count shows no `max` at all**, because the count is the bound.
 *
 * ## The presentation switch is three radios and nothing behind the third
 *
 * All three presentations ship (073, 076, 077) and the field is the kernel's, so the author
 * chooses a LAYOUT here and no answer, key or id moves either way. What sits behind the table
 * option - the column view of the member list, and the library picker filtered to the allowed
 * cell types - belongs to task 077, and behind the per-instance step option to 076. This panel
 * offers the switch and holds the shape they slot into: a `RadioGroup` over
 * {@link REPEAT_PRESENTATIONS} with one hint per option, so a presentation gaining its own
 * controls gains a section under this one rather than a rewrite of it.
 */
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
  /** The step this group sits in, which is what bounds the `fromAnswer` picker. */
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
  // The grid over this group's members alone. Built from a one-item synthetic step rather than
  // by mapping the pins by hand, so the member rows come out of exactly the function the step
  // editor's rows come out of - including their container-scoped positions and their per-pin
  // issues - and the two cannot drift.
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
      {/* AN `h1` for the same reason the step editor's heading is one: on this screen the
          group IS the subject, the form's name lives on the form's own screen, and a column
          whose highest heading were an `h2` is a `heading-order` violation plus a page with no
          level-one heading - both of which `e2e/a11y-axe.pw.ts` sweeps for. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="qcms-group-heading" className="text-base font-semibold text-(--color-text)">
          {t("forms.group.heading", { label: name })}
        </h1>
        {saveFlash}
      </div>
      <p className="text-sm text-(--color-text-muted)">{t("forms.group.note")}</p>

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

      {/* 1. NAME AND ID. The id is shown and never edited: a `groupId` is a permanent name a
             condition can read, exactly as a `stepId` is a permanent name a rule can target,
             so renaming carries it through untouched (`addGroup` is the only minter). */}
      <TextField
        label={t("forms.group.name")}
        description={t("forms.group.nameHint")}
        value={label}
        onChange={onRename}
      />
      <p className="text-sm text-(--color-text-muted)">
        <span className="me-2">{t("forms.group.idLabel")}</span>
        <EntityId kind="group" value={group.groupId} copy />
      </p>

      {/* 2. THE MEMBER QUESTIONS, in the step editor's own ownership grid. */}
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

      {/* 3, 4. THE COUNT SOURCE AND THE BOUNDS, which are one decision with two halves: what
               decides the number, and what bounds it. */}
      <CountFields draft={draft} step={step} group={group} library={library} onCount={onCount} />

      {/* 5. THE INSTANCE HEADING, with the live preview. */}
      <InstanceLabelField group={group} draft={draft} onChange={onInstanceLabel} />

      {/* 6. THE PRESENTATION. */}
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

      {pickerAt !== undefined && (
        <LibraryPicker
          isOpen
          stepTitle={name}
          draft={draft}
          library={library}
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

/**
 * Where the instance count comes from, and what bounds it.
 *
 * ## Three radios and then the fields that source needs
 *
 * A three-way radio rather than a `Select`, because the three options are not three values of
 * one setting: each one changes which other fields exist. A radio group shows all three with
 * their consequences written beside them, which is what an author choosing between "the
 * respondent adds instances" and "an earlier answer decides" actually needs to read.
 *
 * ## Why switching source replaces the whole count rather than patching it
 *
 * The three sources carry different fields - a `fixed` count has a `count` and no bounds, both
 * bounded sources have a `min` and an optional `max` - so a patch would leave `count` beside
 * `min` on one object, which is a shape the kernel's discriminated union has no member for.
 * `setGroupCount` therefore takes a whole value and this is where it is built, carrying across
 * what still applies: the bounds survive a move between the two bounded sources, which is the
 * one carry-over an author would be annoyed to lose.
 *
 * ## All three numbers are TEXT FIELDS, and the reason is the maximum
 *
 * The kit's `NumberField` has no expression for "no value": it would send a number for a field an
 * author has not filled in, and `max` must be able to stay EMPTY, because the kernel's schema makes
 * it optional precisely so a half-filled draft can round-trip through save and reload. Writing a 0
 * there would store a bound nobody chose and turn a required-field prompt into a group that can
 * never have an instance. `min` and the fixed count follow it rather than being a second kind of
 * control in the same three fields, and all three carry `inputMode="numeric"` so a phone keyboard
 * still offers digits.
 */
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
        // NO MAXIMUM FIELD AT ALL for a fixed count, rather than a disabled one: the number is
        // the bound, so a second field would be a control with nothing it could mean.
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
            description={t("forms.group.maxRequired")}
            isRequired
            value={count.max === undefined ? "" : String(count.max)}
            inputMode="numeric"
            onChange={(next) => {
              // AN EMPTY FIELD IS AN ABSENT MAXIMUM, not a zero. The kernel's schema makes
              // `max` optional precisely so a draft can round-trip through save and reload
              // with the field empty; writing a 0 here would store a bound no author chose and
              // turn a required-field prompt into a group that can never have an instance.
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

/**
 * The instance heading template, with the live preview the work order asks for.
 *
 * The preview substitutes `1` for `{n}` and nothing else, which is exactly what the renderer
 * does with a template: `{n}` is the live one-based ordinal and is the only placeholder the
 * kernel fills (`INSTANCE_LABEL_PLACEHOLDER`). A template carrying any other token therefore
 * previews with the braces still in it, which is the honest rendering - a respondent would
 * read them too - and is the state publish refuses with
 * `INSTANCE_LABEL_PLACEHOLDER_UNKNOWN`. Nothing here corrects the author's text: a preview
 * that silently dropped an unknown token would hide the refusal it exists to make visible.
 */
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
      <TextField
        label={t("forms.group.instanceLabel")}
        description={t("forms.group.instanceLabelHint")}
        value={template}
        onChange={onChange}
      />
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

/**
 * The questions a `fromAnswer` count could point at: the ones pinned **strictly before this
 * group's span** and outside every group.
 *
 * Both halves are publish refusals pre-empted at the control rather than explained afterwards.
 * A count question after the group is `REPEAT_COUNT_BACKWARD_REF` (forward-only rule 3), and a
 * count question inside a group is `REPEAT_COUNT_INSIDE_GROUP` (Q27) - it is answered once per
 * instance and so has no single value. The type check is the third, and it is the one this
 * list can only make when the library answered: `REPEAT_COUNT_NOT_A_NUMBER` needs the pinned
 * version's type, so a failed library read offers every earlier pin rather than filtering the
 * list down to nothing and implying the form has no number question (issues 572, 544).
 */
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

/**
 * A whole count value for a newly chosen source, carrying over what still applies.
 *
 * `fixed` takes the current minimum as its number when there is one, because an author moving
 * a "respondent adds, at least 2" group to a fixed count almost always means two. Both bounded
 * sources keep each other's bounds, and **neither invents a `max`**: the field starts empty and
 * stays empty until the author answers, which is the whole point of its being required.
 */
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
    // An empty string when the form pins no eligible question yet: that is `DANGLING_QUESTION_REF`
    // at publish and the panel's own "nothing to point at" notice before it, which together say
    // more than silently refusing the author's choice of source would.
    questionId: previous.source === "fromAnswer" ? previous.questionId : (firstCandidate ?? ""),
    ...bounds,
  };
}

/** A typed number field's value as a whole number, or the value it had when it is not one. */
function wholeNumber(text: string, fallback: number): number {
  const parsed = Number.parseInt(text.trim(), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

/**
 * A mutually exclusive choice, as a native radio group with a sentence per option.
 *
 * ## Why a native control and not a kit one
 *
 * `@roonga/qcms-ui/kit` has no radio. The two choices on this panel are each a three-way
 * decision where **every option changes which other fields exist**, so a `Select` would hide
 * two of the three consequences behind a popover an author has to open to compare them - and
 * what they are comparing is prose ("the respondent presses Add" against "a number question
 * earlier in the form decides"), not three values of one setting.
 *
 * `library-picker.tsx` records the same call for the same reason and is the precedent:
 * ADR-22's single-stack rule is about a second design language accumulating outside
 * `packages/ui`, and a platform radio wearing `accent-color: var(--color-primary)` is not a
 * design language. `apps/portal/components/appearance-controls.tsx` builds its segmented
 * control out of the same markup. A kit radio is the right long-term answer and it is an
 * upstream `a2-react-aria` change rather than this task's.
 *
 * `name` groups the inputs so the browser gives the group one tab stop with arrow-key
 * traversal inside it, which is the behaviour a hand-built group most often loses.
 *
 * **The description sits OUTSIDE the `<label>`**, and that is the detail a hand-built group gets
 * wrong: a `<label>` wrapping an input contributes its whole text content to the input's
 * accessible name, so a sentence inside it makes every option announce as its label followed by
 * its own explanation - and makes an exact-name lookup for the option impossible, for a test and
 * for speech input alike. It is wired with `aria-describedby` instead, which is what announces a
 * description as a description.
 */
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
