import {
  countBounds,
  isRepeatGroup,
  stepQuestionRefs,
  type FormDefinition,
  type RepeatGroup,
} from "@roonga/qcms-core";
import { csvField } from "@roonga/qcms-csv";

export { csvField };

/** Without it Excel reads a UTF-8 file as the legacy system codepage. */
export const UTF8_BOM = "﻿";

export const CRLF = "\r\n";

export const METADATA_COLUMNS = ["session_id", "form_version", "submitted_at", "access_mode"];

/** Both keys: an ordinal is not stable across a removal, and an `ins_` id cannot be sorted on. */
export const GROUP_METADATA_COLUMNS = ["session_id", "instance_ordinal", "instance_id"];

export const LONG_SHAPE = "long";
export const WIDE_SHAPE = "wide";
export const EXPORT_SHAPES = [LONG_SHAPE, WIDE_SHAPE] as const;
export type ExportShape = (typeof EXPORT_SHAPES)[number];

export function isExportShape(value: string): value is ExportShape {
  return (EXPORT_SHAPES as readonly string[]).includes(value);
}

export type ResponseColumn =
  | { readonly header: string; readonly questionId: string }
  | {
      readonly header: string;
      readonly questionId: string;
      readonly groupId: string;
      readonly index: number;
    };

export interface GroupFileColumns {
  readonly groupId: string;
  readonly questionIds: readonly string[];
}

/** The full pinned set, not the export's column list: {@link responseColumns} is that. */
export function questionIdsInDocumentOrder(definition: FormDefinition): string[] {
  const ids: string[] = [];
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) ids.push(item.questionId);
  }
  return ids;
}

/**
 * Throws rather than defaulting to `min`: publish refuses a group with no `max`, so
 * an absent one is a bug, and a short header would drop trailing instances silently.
 */
export function wideSlotCount(group: RepeatGroup): number {
  const { max } = countBounds(group.count);
  if (max === undefined) {
    throw new Error(
      `wide CSV export: group "${group.groupId}" declares no max, which publish refuses`,
    );
  }
  return max;
}

export function indexedColumnHeader(questionId: string, index: number): string {
  return `${questionId}__${String(index)}`;
}

/** In the long shape a group contributes nothing here: its answers go to its own file. */
export function responseColumns(
  definition: FormDefinition,
  shape: ExportShape = LONG_SHAPE,
): ResponseColumn[] {
  return definition.steps.flatMap((step) =>
    step.items.flatMap((item) => {
      if (!isRepeatGroup(item)) return [questionColumn(item.questionId)];
      return shape === LONG_SHAPE ? [] : indexedColumnsFor(item);
    }),
  );
}

function indexedColumnsFor(group: RepeatGroup): ResponseColumn[] {
  const slots = wideSlotCount(group);
  return group.items.flatMap((member) =>
    Array.from({ length: slots }, (_unused, at) => ({
      header: indexedColumnHeader(member.questionId, at + 1),
      questionId: member.questionId,
      groupId: group.groupId,
      index: at + 1,
    })),
  );
}

/** Empty for a form with no group, which is how the route chooses a single file over a zip. */
export function groupFileColumns(definition: FormDefinition): GroupFileColumns[] {
  const files: GroupFileColumns[] = [];
  for (const step of definition.steps) {
    for (const item of step.items) {
      if (!isRepeatGroup(item)) continue;
      files.push({
        groupId: item.groupId,
        questionIds: item.items.map((member) => member.questionId),
      });
    }
  }
  return files;
}

export function groupFileName(groupId: string): string {
  return `${groupId}.csv`;
}

export const RESPONSES_FILE_NAME = "responses.csv";

/** Read out of JSONB, so an unrecognised shape is no instances: an export must not throw mid-stream. */
export function groupInstances(
  answers: Record<string, unknown>,
  groupId: string,
): ReadonlyArray<Record<string, unknown>> {
  const value = answers[groupId];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

const INSTANCE_ID_KEY = "instance_id";

/** Unquoted: {@link csvField} applies the quoting and the formula-injection guard. */
export function serializeAnswerForCsv(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(";");
  // Defensive: no canonical answer value is a plain object, but never throw mid-stream.
  return JSON.stringify(value);
}

function headerRow(fixed: readonly string[], headers: readonly string[]): string {
  return [...fixed, ...headers].map(csvField).join(",") + CRLF;
}

export function questionColumn(questionId: string): ResponseColumn {
  return { header: questionId, questionId };
}

export function csvHeaderRow(columns: readonly ResponseColumn[]): string {
  return headerRow(
    METADATA_COLUMNS,
    columns.map((column) => column.header),
  );
}

export function groupHeaderRow(file: GroupFileColumns): string {
  return headerRow(GROUP_METADATA_COLUMNS, file.questionIds);
}

export interface ExportRow {
  readonly sessionId: string;
  readonly formVersion: number;
  readonly submittedAt: Date;
  readonly accessMode: string;
  readonly answers: Record<string, unknown>;
}

function responseCell(row: ExportRow, column: ResponseColumn): string {
  if (!("groupId" in column)) return serializeAnswerForCsv(row.answers[column.questionId]);
  const instance = groupInstances(row.answers, column.groupId)[column.index - 1];
  // The header's width is the version's `max`, not this response's roster.
  return instance === undefined ? "" : serializeAnswerForCsv(instance[column.questionId]);
}

export function csvDataRow(row: ExportRow, columns: readonly ResponseColumn[]): string {
  const meta = [
    row.sessionId,
    String(row.formVersion),
    row.submittedAt.toISOString(),
    row.accessMode,
  ];
  const cells = columns.map((column) => responseCell(row, column));
  return [...meta, ...cells].map(csvField).join(",") + CRLF;
}

export function groupDataRows(row: ExportRow, file: GroupFileColumns): string {
  let out = "";
  const instances = groupInstances(row.answers, file.groupId);
  for (const [position, instance] of instances.entries()) {
    const meta = [
      row.sessionId,
      String(position + 1),
      typeof instance[INSTANCE_ID_KEY] === "string" ? instance[INSTANCE_ID_KEY] : "",
    ];
    const cells = file.questionIds.map((questionId) => serializeAnswerForCsv(instance[questionId]));
    out += [...meta, ...cells].map(csvField).join(",") + CRLF;
  }
  return out;
}
