import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";

import type { ReadState } from "../read-state.ts";

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
  /** Library-owned display text, or `""` when there is none to show. */
  readonly label: string;
  /**
   * What the empty label cell says instead, already localized.
   *
   * Resolved here rather than in the component because it is one of the four
   * library-owned facts whose wording depends on whether the library was READ, and
   * keeping all four in one place is what stops the next one being decided in JSX
   * (issue 572). A library that answered and carried no label says "no label in the
   * library"; a library that did not answer says only that the label is not known.
   */
  readonly labelFallback: string;
  /** Library-owned type, already localized, or the "unknown" line. */
  readonly type: string;
  /**
   * The pinned version's own status.
   *
   * `undefined` means the library was read and does not hold this version, which is a
   * finding worth a tag. `"unknown"` means the library was not read at all, which is not
   * a finding about anything and gets no tag (`pinStateLabel`).
   */
  readonly versionStatus: string | undefined;
  /**
   * The published versions this pin could be moved to, excluding the current one, or
   * `undefined` when the library was not read.
   *
   * A union rather than an empty array for the same reason `ReadState` is a union rather
   * than a `failed` flag (issues 543, 572, `lib/read-state.ts`): "there is nowhere else
   * to move this pin" and "nobody managed to ask" are different answers, and an empty
   * array can only say the first one. The move menu said the first one for years of
   * every failed library read.
   */
  readonly otherVersions: readonly number[] | undefined;
  /**
   * What the engine said about this pin, or `undefined` when it has not been asked yet.
   *
   * A union for exactly the reason `otherVersions` above is one, and issue 625 is where
   * the empty array cost something: the builder seeds its issue list empty and only
   * validates once the author has changed something, so every pin of an untouched form
   * rendered `Issues: None` about a draft nothing had checked. "No issues here" and "no
   * verdict yet" are different answers and an empty array can only say the first.
   */
  readonly issues: readonly FormIssue[] | undefined;
}

/**
 * The rows of one step, in the order the form serves them.
 *
 * ## Why the library arrives as a `ReadState` (issues 572, 544)
 *
 * Every library-owned cell of this grid is a lookup, and an empty library is not a
 * neutral input to a lookup: every one of them misses. Handed `ok ? data : []` - the
 * collapse issue 544 filed - a library that could not be read produced a grid claiming,
 * on EVERY pin in the form, that there was no label in the library, that the type was
 * unknown, that the version was not found, and that there was no other version to move
 * to. Four positive claims about a library nobody managed to read, printed under the
 * page's own alert saying so, and together they read as "this form has been gutted".
 *
 * A failed read now says only that these things are not known. Nothing else about the
 * row changes: position, version and the engine's issues are form-owned facts that came
 * from a read that succeeded, and every control the grid draws still works.
 */
export function pinRows(
  step: DraftStep,
  library: ReadState<readonly PinnableQuestion[]>,
  issues: readonly FormIssue[] | undefined,
): readonly PinRowView[] {
  return step.items.map((pin, index) => {
    const question = library.ok
      ? library.data.find((entry) => entry.questionId === pin.questionId)
      : undefined;
    return {
      questionId: pin.questionId,
      version: pin.version,
      position: index + 1,
      total: step.items.length,
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
      // The absence of a verdict is carried down to every row rather than flattened into
      // an empty one, so the cell that renders it can tell the two apart (issue 625).
      issues: issues === undefined ? undefined : issuesForPin(issues, pin.questionId),
    };
  });
}

/** A stand-in so the version helpers can be asked about a question the library lost. */
const EMPTY_QUESTION: PinnableQuestion = {
  questionId: "",
  slug: "",
  label: null,
  type: null,
  versions: [],
};

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

/**
 * What a pinned version's status is worth saying, or nothing for the ordinary case.
 *
 * `"unknown"` joins `"published"` in saying nothing, and for the same reason rather than
 * a different one: neither is a finding. A published pin is what the author asked for,
 * and an unread library has found nothing at all (issue 572). Only `undefined` - the
 * library answered and does not hold this version - is worth a tag.
 */
export function pinStateLabel(status: string | undefined): string | undefined {
  if (status === "published" || status === "unknown") return undefined;
  if (status === "deprecated") return t("forms.step.pinDeprecated");
  if (status === "draft") return t("forms.step.pinDraft");
  return t("forms.step.pinMissing");
}
