import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";
import type { QuestionType } from "../questions/types.ts";

import type { DraftPin, PinnableQuestion } from "./types.ts";

/**
 * The table presentation's **column view** of a group's member list, and the type filter
 * its library picker applies (task 077, ADR-43, plan section 6.3).
 *
 * ## There is no table question, so there is no column editor either
 *
 * Under ADR-42 a table is a **presentation** of a repeating group. The "column editor"
 * the plan names is therefore a second **view of one list**: each row of this view is a
 * column of the rendered table, showing the column's label, the question underneath it
 * and that question's type. Adding a column is adding a question to the group, and
 * removing one is removing a member. That is what keeps the author's two mental models - a
 * group, and a table - from becoming two data models.
 *
 * ## The type is SHOWN, never chosen
 *
 * A column's type is the member question's own type, decided in the question editor and
 * frozen by the pin. Offering a picker here would imply a table column has a type of its
 * own, which is exactly the model ADR-42 refused: every cell is an ordinary question with
 * an ordinary `AnswerValue`, which is what keeps per-cell validation, per-cell retraction,
 * the rules DSL, the ledger grain and the export grain working unchanged.
 *
 * ## Why this is a module rather than a block inside the view
 *
 * The rules are a mapping and a filter over their inputs, so they are written here where a
 * test can state each one in the rule's own words, and the component keeps the markup
 * (`docs/COMPONENT_GUIDELINES.md`, issue #697). `picker-selection.ts` next door is the
 * worked example.
 *
 * ## The five types are RESTATED here, and pinned to the kernel by a test
 *
 * R2 refuses the admin a value import from `@roonga/qcms-core` - "the admin runs no kernel
 * code" - and the kernel's `TABLE_COLUMN_TYPES` is a value. So the list is written out
 * here, exactly as `lib/questions/types.ts` writes out the seven question types and for the
 * same reason, and `table-columns.test.ts` imports the kernel's constant and asserts the
 * two are equal. That is the shape `lib/forms/condition.ts` and ADR-03's own Note
 * established for the operator list: the copy exists because the boundary requires it, and
 * a test is what stops it drifting from its original.
 *
 * It matters that they agree because the publish refusal and this filter are one ruling
 * seen from two sides: an author refused here reads the same five types the publish error
 * would have named, and the picker is where they find out instead of at publish.
 */

/**
 * The five types a table column may be (Q12, ruled 2026-09-29).
 *
 * A restatement of the kernel's `TABLE_COLUMN_TYPES`, pinned to it by a test rather than by
 * an import, because R2 gives the admin no value import from the kernel. The order is the
 * order the five are named everywhere: the plan, the work order and the publish refusal.
 */
export const ALLOWED_COLUMN_TYPES: readonly QuestionType[] = [
  "shortText",
  "number",
  "date",
  "boolean",
  "singleChoice",
];

/** Whether a question of this type may be a column of a table-presented group. */
export function isAllowedColumnType(type: QuestionType | null): boolean {
  return type !== null && (ALLOWED_COLUMN_TYPES as readonly string[]).includes(type);
}

/** One row of the column view: one column of the table the respondent will see. */
export interface ColumnRow {
  /** The column's position, 1-based, which is the order the table draws them in. */
  readonly ordinal: number;
  readonly questionId: string;
  readonly version: number;
  /** The column header the respondent reads: the question's own label. */
  readonly label: string;
  /** The question's type, localized for display. Shown, never chosen. */
  readonly type: string;
  /**
   * False when publish will refuse this column (`TABLE_COLUMN_TYPE_NOT_ALLOWED`).
   *
   * The row is still listed, and that is deliberate: a member the author already added
   * before switching the presentation to `table` has to be visible and nameable, or the
   * publish refusal names a column the panel does not show. The row says why and points
   * at the stacked presentation, which is the same sentence the publish error carries.
   */
  readonly allowed: boolean;
}

/**
 * The group's member list as columns, in document order.
 *
 * A member the library does not carry is listed with the labels the catalog uses for an
 * unknown question rather than dropped, for the same reason the pin grid keeps such a row:
 * an author looking for a pin they can see in the draft must not find the panel silently
 * one row short.
 */
export function tableColumnRows(
  members: readonly DraftPin[],
  library: readonly PinnableQuestion[],
): readonly ColumnRow[] {
  return members.map((member, index) => {
    const question = library.find((entry) => entry.questionId === member.questionId);
    const type = question?.type ?? null;
    return {
      ordinal: index + 1,
      questionId: member.questionId,
      version: member.version,
      label:
        question === undefined ? t("forms.step.labelUnknown") : textOf(question.label ?? undefined),
      type: type === null ? t("questions.column.typeUnknown") : t(`questions.type.${type}`),
      allowed: isAllowedColumnType(type),
    };
  });
}

/**
 * The sentence the filtered picker and the column view both say, naming the five allowed
 * types and the stacked presentation as the way out.
 *
 * One function rather than two call sites spelling the same thing, because the whole point
 * of the refusal naming an alternative is that the alternative is named the same way
 * wherever the author meets it - the picker, the column view and the publish error.
 */
export function columnTypeNote(): string {
  return t("forms.columns.typeNote", {
    types: ALLOWED_COLUMN_TYPES.map((type) => t(`questions.type.${type}`)).join(", "),
  });
}
