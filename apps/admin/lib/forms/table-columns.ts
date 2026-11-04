import { t } from "../i18n/en.ts";
import { textOf } from "../questions/definition.ts";
import type { QuestionType } from "../questions/types.ts";

import type { DraftPin, PinnableQuestion } from "./types.ts";

// Table presentation changes layout only; columns retain their pinned question types and the same group data model.

// Mirror TABLE_COLUMN_TYPES without importing kernel values; tests pin the lists together.
export const ALLOWED_COLUMN_TYPES: readonly QuestionType[] = [
  "shortText",
  "number",
  "date",
  "boolean",
  "singleChoice",
];

export function isAllowedColumnType(type: QuestionType | null): boolean {
  return type !== null && (ALLOWED_COLUMN_TYPES as readonly string[]).includes(type);
}

export interface ColumnRow {
  readonly ordinal: number;
  readonly questionId: string;
  readonly version: number;

  readonly label: string;

  readonly type: string;

  readonly allowed: boolean;
}

// Keep unresolved members visible with unknown labels rather than silently hiding draft pins.
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

// Use one alternative-layout name in picker, column view and publish refusal.
export function columnTypeNote(): string {
  return t("forms.columns.typeNote", {
    types: ALLOWED_COLUMN_TYPES.map((type) => t(`questions.type.${type}`)).join(", "),
  });
}
