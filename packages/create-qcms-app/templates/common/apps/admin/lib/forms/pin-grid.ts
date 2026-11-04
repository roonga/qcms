import { t, tPlural } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import type { ReadState } from "../read-state.ts";

import { countBounds, pinnableVersions, pinnedVersionStatus } from "./draft.ts";
import { issuesForGroup } from "./issues.ts";
import {
  isDraftGroup,
  type DraftGroup,
  type DraftPin,
  type DraftStep,
  type FormIssue,
  type PinnableQuestion,
  type RepeatPresentation,
} from "./types.ts";

// Position and pin version are form-owned controls; identity, label and type remain library-owned text.
export type PinRowAction = "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove";

export interface PinRowMenuItem {
  readonly action: PinRowAction;
  readonly label: string;
  readonly isDisabled: boolean;
  readonly isDanger: boolean;
}

export interface PinRowView {
  readonly questionId: string;
  // Count position within the pin's own container; reorder must not move a member out of its group.
  readonly groupId?: string | undefined;
  // A form owns its frozen pin version; never auto-upgrade it.
  readonly version: number;
  readonly position: number;
  readonly total: number;

  readonly label: string;
  // Distinguish a missing label from an unread library; a failed read cannot establish absence.
  readonly labelFallback: string;

  readonly type: string;
  // undefined means the read found no version; unknown means the library could not be read.
  readonly versionStatus: string | undefined;
  // undefined means no library verdict; an empty array asserts that no alternate versions exist.
  readonly otherVersions: readonly number[] | undefined;
  // undefined means unchecked; an empty issue list asserts a real all-clear.
  readonly issues: readonly FormIssue[] | undefined;
}

// Preserve failed library reads rather than replacing them with empty data; otherwise every lookup invents absence.
export function pinRows(
  step: DraftStep,
  library: ReadState<readonly PinnableQuestion[]>,
  issues: readonly FormIssue[] | undefined,
): readonly PinRowView[] {
  return stepGridRows(step, library, issues).flatMap((row) =>
    row.kind === "pin" ? [row.pin] : [],
  );
}

export type StepGridRow =
  | { readonly kind: "pin"; readonly pin: PinRowView }
  | { readonly kind: "group"; readonly group: GroupBoundaryView };

export interface GroupBoundaryView {
  readonly groupId: string;

  readonly label: string;

  readonly members: number;

  readonly memberSummary: string;

  readonly countSummary: string;
  readonly presentation: RepeatPresentation;
  readonly presentationLabel: string;
  // Show group publishability at its listed boundary, not only inside an editor panel.
  readonly maxMissing: boolean;

  readonly issues: readonly FormIssue[] | undefined;

  readonly position: number;
  readonly total: number;
}

export function stepGridRows(
  step: DraftStep,
  library: ReadState<readonly PinnableQuestion[]>,
  issues: readonly FormIssue[] | undefined,
): readonly StepGridRow[] {
  const ownPins = step.items.filter((item) => !isDraftGroup(item));
  let ownIndex = 0;
  return step.items.flatMap((item, index): readonly StepGridRow[] => {
    if (!isDraftGroup(item)) {
      ownIndex += 1;
      return [
        { kind: "pin", pin: pinRow(item, library, issues, ownIndex, ownPins.length, undefined) },
      ];
    }
    return [
      { kind: "group", group: groupBoundary(item, issues, index + 1, step.items.length) },
      ...item.items.map((member, at): StepGridRow => ({
        kind: "pin",
        pin: pinRow(member, library, issues, at + 1, item.items.length, item.groupId),
      })),
    ];
  });
}

function pinRow(
  pin: DraftPin,
  library: ReadState<readonly PinnableQuestion[]>,
  issues: readonly FormIssue[] | undefined,
  position: number,
  total: number,
  groupId: string | undefined,
): PinRowView {
  const question = library.ok
    ? library.data.find((entry) => entry.questionId === pin.questionId)
    : undefined;
  return {
    questionId: pin.questionId,
    ...(groupId === undefined ? {} : { groupId }),
    version: pin.version,
    position,
    total,
    label: textOf(question?.label ?? undefined),
    labelFallback: t(library.ok ? "forms.step.labelMissing" : "forms.step.labelUnknown"),
    type:
      question === undefined || question.type === null
        ? t("questions.column.typeUnknown")
        : t(`questions.type.${question.type}`),
    versionStatus: library.ok ? pinnedVersionStatus(question, pin.version) : "unknown",
    otherVersions: library.ok
      ? pinnableVersions(question ?? EMPTY_QUESTION).filter((version) => version !== pin.version)
      : undefined,
    // Carry an unchecked verdict through to rows instead of fabricating an empty successful result.
    issues: issues === undefined ? undefined : issuesForPin(issues, pin.questionId),
  };
}

function groupBoundary(
  group: DraftGroup,
  issues: readonly FormIssue[] | undefined,
  position: number,
  total: number,
): GroupBoundaryView {
  const label = textOf(group.label);
  const bounds = countBounds(group.count);
  return {
    groupId: group.groupId,
    label: label === "" ? t("forms.group.untitled") : label,
    members: group.items.length,
    memberSummary: tPlural(
      "forms.group.memberCountOne",
      "forms.group.memberCount",
      group.items.length,
    ),
    countSummary: countSummary(group),
    presentation: group.presentation,
    presentationLabel: t(`forms.group.presentation.${group.presentation}`),
    maxMissing: bounds.max === undefined,
    issues: issues === undefined ? undefined : issuesForGroup(issues, group.groupId),
    position,
    total,
  };
}

function countSummary(group: DraftGroup): string {
  const count = group.count;
  if (count.source === "fixed") {
    return t("forms.group.countSummary.fixed", { count: count.count });
  }
  if (count.max === undefined) {
    return count.source === "fromAnswer"
      ? t("forms.group.countSummary.fromAnswerNoMax", { questionId: count.questionId })
      : t("forms.group.countSummary.openNoMax");
  }
  return count.source === "fromAnswer"
    ? t("forms.group.countSummary.fromAnswer", {
        questionId: count.questionId,
        min: count.min,
        max: count.max,
      })
    : t("forms.group.countSummary.open", { min: count.min, max: count.max });
}

const EMPTY_QUESTION: PinnableQuestion = {
  questionId: "",
  slug: "",
  label: null,
  type: null,
  versions: [],
};

export function issuesForPin(
  issues: readonly FormIssue[],
  questionId: string,
): readonly FormIssue[] {
  return issues.filter(
    (issue) => issue.path?.question === questionId && issue.path?.rule === undefined,
  );
}

// Include row identity so menu names distinguish otherwise identical actions.
export function pinRowMenuItems(row: PinRowView): readonly PinRowMenuItem[] {
  const questionId = row.questionId;
  return [
    {
      action: "insertAbove",
      label: t("forms.step.insertAbove", { questionId }),
      isDisabled: false,
      isDanger: false,
    },
    {
      action: "insertBelow",
      label: t("forms.step.insertBelow", { questionId }),
      isDisabled: false,
      isDanger: false,
    },
    {
      action: "moveUp",
      label: t("forms.step.pinUp", { questionId }),
      isDisabled: row.position <= 1,
      isDanger: false,
    },
    {
      action: "moveDown",
      label: t("forms.step.pinDown", { questionId }),
      isDisabled: row.position >= row.total,
      isDanger: false,
    },
    {
      action: "remove",
      label: t("forms.step.removePin", { questionId }),
      isDisabled: false,
      isDanger: true,
    },
  ];
}

export function pinStateLabel(status: string | undefined): string | undefined {
  if (status === "published" || status === "unknown") return undefined;
  if (status === "deprecated") return t("forms.step.pinDeprecated");
  if (status === "draft") return t("forms.step.pinDraft");
  return t("forms.step.pinMissing");
}
