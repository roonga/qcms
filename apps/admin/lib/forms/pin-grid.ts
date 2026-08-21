import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import { pinnableVersions, pinnedVersionStatus } from "./draft.ts";
import type { DraftStep, FormIssue, PinnableQuestion } from "./types.ts";

/**
 * The pin list's view model (issue 517).
 *
 * The step editor's pin list is the app's one genuinely **mixed-ownership** table, and
 * this module is where that split is written down rather than implied by JSX:
 *
 * - **form-owned**: the pin's position in the step, and the version it points at. Both
 *   are editable here, and the grid draws them as controls.
 * - **library-owned**: `questionId`, `label` and `type`. None of them can be changed
 *   from a form, so the grid draws them as text.
 *
 * Keeping the row shape and the menu's contents out of the component buys two things.
 * The component becomes a rendering of a value, so an ownership test can assert over
 * markup without driving a browser; and the five menu entries the acceptance names are
 * a list that can be asserted directly, instead of only existing while a popup is open.
 *
 * ## Why `remove` is never disabled and `moveUp`/`moveDown` are
 *
 * A step may legitimately hold no questions - `forms.step.empty` is a real state the
 * editor renders - so removing the last pin is allowed. Moving past either end is not a
 * state, it is a no-op, and `movePinWithinStep` already refuses it; the menu says so
 * up front rather than offering an item that does nothing.
 */
export type PinRowAction = "insertAbove" | "insertBelow" | "moveUp" | "moveDown" | "remove";

export interface PinRowMenuItem {
  readonly action: PinRowAction;
  readonly label: string;
  readonly isDisabled: boolean;
  readonly isDanger: boolean;
}

/** One pin, as the ownership grid renders it. Positions are 1-based, as authors count. */
export interface PinRowView {
  /** Library-owned, and the row's identity: `q_at_fault_accident`. */
  readonly questionId: string;
  /** Form-owned: which frozen version this form serves (R7 - never auto-upgraded). */
  readonly version: number;
  readonly position: number;
  readonly total: number;
  /** Library-owned display text, or `""` when the library row carried no label. */
  readonly label: string;
  /** Library-owned type, already localized, or the "not in library" line. */
  readonly type: string;
  /** The pinned version's own status, or `undefined` when the library lost it. */
  readonly versionStatus: string | undefined;
  /** The published versions this pin could be moved to, excluding the current one. */
  readonly otherVersions: readonly number[];
  readonly issues: readonly FormIssue[];
}

/** The rows of one step, in the order the form serves them. */
export function pinRows(
  step: DraftStep,
  library: readonly PinnableQuestion[],
  issues: readonly FormIssue[],
): readonly PinRowView[] {
  return step.items.map((pin, index) => {
    const question = library.find((entry) => entry.questionId === pin.questionId);
    return {
      questionId: pin.questionId,
      version: pin.version,
      position: index + 1,
      total: step.items.length,
      label: textOf(question?.label ?? undefined),
      type:
        question === undefined || question.type === null
          ? t("questions.column.typeUnknown")
          : t(`questions.type.${question.type}`),
      versionStatus: pinnedVersionStatus(question, pin.version),
      otherVersions:
        question === undefined
          ? []
          : pinnableVersions(question).filter((version) => version !== pin.version),
      issues: issuesForPin(issues, pin.questionId),
    };
  });
}

/** The issues that belong to one pin: about this question, and not about a rule. */
export function issuesForPin(
  issues: readonly FormIssue[],
  questionId: string,
): readonly FormIssue[] {
  return issues.filter(
    (issue) => issue.path?.question === questionId && issue.path?.rule === undefined,
  );
}

/**
 * The five entries of a row's grip menu.
 *
 * **Insert above and insert below are not a convenience.** They are the equivalent
 * controls that let a row-boundary insert affordance exist at all under WCAG 2.2
 * SC 2.5.8, and they are the single-pointer, non-dragging reorder path SC 2.5.7 asks
 * for wherever a drag exists. Both are why `plan/admin-mobile-stance.md` calls the
 * menu's move items "how reordering actually happens on the supported path" rather
 * than a conformance formality. Removing either is a conformance regression, not a
 * simplification, so the list is built here and asserted in `pin-grid.test.ts`.
 *
 * Every label names its row. Two rows' menus are otherwise five identical words.
 */
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

/** What a pinned version's status is worth saying, or nothing for the ordinary case. */
export function pinStateLabel(status: string | undefined): string | undefined {
  if (status === "published") return undefined;
  if (status === "deprecated") return t("forms.step.pinDeprecated");
  if (status === "draft") return t("forms.step.pinDraft");
  return t("forms.step.pinMissing");
}
