import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { isPinned } from "./draft.ts";
import type { DraftForm, DraftPin, PinnableQuestion } from "./types.ts";

// Keep the picker decisions pure so portalled dialog rendering cannot hide selection rules from tests.

export function rowId(questionId: string, version: number): string {
  return `${questionId}@${String(version)}`;
}

export interface PickerRow {
  readonly questionId: string;
  readonly label: string;
  readonly type: string;
  readonly version: number;
  readonly state: string;
  readonly pinnable: boolean;
}

export interface ChoiceRow extends PickerRow {
  readonly checked: boolean;
  // Only one version per question may be selected; hide sibling-version controls while a version is chosen.
  readonly choosable: boolean;
}

export interface ChosenRow extends DraftPin {
  readonly label: string;
}

function matches(question: PinnableQuestion, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = `${question.questionId} ${question.slug} ${textOf(question.label ?? undefined)}`;
  return haystack.toLowerCase().includes(needle);
}

function stateLabel(already: boolean, status: string): string {
  if (already) return t("forms.picker.statePinned");
  if (status === "deprecated") return t("forms.picker.stateDeprecated");
  return t("forms.picker.statePinnable");
}

// Filter unsupported column types, but keep deprecated and pinned rows visible with their refusal reasons.
export function pinnableRows(
  library: readonly PinnableQuestion[],
  draft: DraftForm,
  search: string,
  allowedTypes?: readonly string[],
): PickerRow[] {
  const rows: PickerRow[] = [];

  for (const question of library) {
    if (!matches(question, search)) continue;
    if (
      allowedTypes !== undefined &&
      (question.type === null || !allowedTypes.includes(question.type))
    ) {
      continue;
    }
    const already = isPinned(draft, question.questionId);
    for (const version of question.versions) {
      // Draft versions are not pinnable and must not appear as choices.
      if (version.status === "draft") continue;
      rows.push({
        questionId: question.questionId,
        label: textOf(question.label ?? undefined),
        type:
          question.type === null
            ? t("questions.column.typeUnknown")
            : t(`questions.type.${question.type}`),
        version: version.version,
        state: stateLabel(already, version.status),
        pinnable: !already && version.status !== "deprecated",
      });
    }
  }
  return rows;
}

// Enforce one pin per question while choosing, before the kernel would reject the save.
export function withChoices(
  rows: readonly PickerRow[],
  chosen: readonly DraftPin[],
): readonly ChoiceRow[] {
  return rows.map((row) => {
    const held = chosen.find((pin) => pin.questionId === row.questionId)?.version;
    if (held === row.version) {
      return { ...row, checked: true, choosable: true, state: t("forms.picker.stateChosen") };
    }
    if (held !== undefined) {
      return {
        ...row,
        checked: false,
        choosable: false,
        state: t("forms.picker.stateOtherVersionChosen", { version: held }),
      };
    }
    return { ...row, checked: false, choosable: row.pinnable };
  });
}

// Chosen insertion order is the form's authored order, independent of library sorting.
export function choose(chosen: readonly DraftPin[], pin: DraftPin): readonly DraftPin[] {
  return [...chosen.filter((entry) => entry.questionId !== pin.questionId), pin];
}

// Key selection by question ID, not version, because only one version can be chosen at a time.
export function unchoose(chosen: readonly DraftPin[], questionId: string): readonly DraftPin[] {
  return chosen.filter((pin) => pin.questionId !== questionId);
}

// Resolve choices against the full library so filtering cannot hide selections.
// Omit entries whose names cannot be resolved, including from commit, so no unseen pin is added.
export function chosenDetail(
  library: readonly PinnableQuestion[],
  chosen: readonly DraftPin[],
): readonly ChosenRow[] {
  const rows: ChosenRow[] = [];
  for (const pin of chosen) {
    const question = library.find((entry) => entry.questionId === pin.questionId);
    if (question === undefined) continue;
    rows.push({ ...pin, label: textOf(question.label ?? undefined) });
  }
  return rows;
}
