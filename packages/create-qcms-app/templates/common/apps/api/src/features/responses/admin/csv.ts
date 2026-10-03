/**
 * CSV export serialization (task 023, extended for repeating groups by task 075)
 * - pure, fetch-pure (R4) string helpers.
 *
 * The CSV export projects `reporting.responses` rows onto the columns of **one
 * requested form version**, in **document order** (the order the questionIds
 * appear walking `steps` then `items` in the frozen definition). Because the
 * column set depends on the version's shape, the export route requires a
 * `version` parameter.
 *
 * Encoding decisions, all frozen here so the golden export is byte-stable:
 *
 * - **UTF-8 BOM.** The stream is prefixed with `U+FEFF`. Excel, the dominant CSV
 *   consumer, assumes the legacy system codepage for a BOM-less file and mojibakes
 *   non-ASCII answers; the BOM makes it detect UTF-8. Other tools ignore it.
 * - **CRLF line terminator** (RFC 4180 §2.1).
 * - **RFC 4180 quoting** (§2.5–2.7): a field is wrapped in double quotes when it
 *   contains a comma, a double quote, CR, or LF; embedded double quotes are
 *   doubled. Other fields are emitted bare.
 * - **Formula-injection guard** (issue #470): a cell starting `=`, `+`, `-`, `@`,
 *   tab or CR is prefixed with an apostrophe, because several spreadsheet
 *   programs evaluate such a cell on open and every answer cell here is written
 *   by an anonymous respondent through a public portal. Both this and the quoting
 *   above come from `@roonga/qcms-csv`, shared with the admin's link export so the two
 *   cannot drift apart again. They apply in **every** file of **both** shapes.
 * - **multiChoice** is serialized as its option ids joined by `;` (e.g.
 *   `opt_a;opt_b;opt_c`) - a single CSV field, documented, so the `,` delimiter
 *   is never ambiguous with a selection separator.
 * - A question with **no answer** in a given response is an empty field.
 *
 * Answer *values* are export payload, never logged (SEC-8).
 *
 * ## Two shapes, because one column per question stopped being possible
 *
 * A repeating group is answered once per instance (ADR-42), so "one column per
 * questionId" has no answer for a member question: an open-ended group has no
 * column count until the data is read, and a column set that depends on the data
 * rather than on the form version is not a contract a consumer can bind to. The
 * Code Owner ruled **both shapes ship** (Q17, 2026-09-29):
 *
 * - **{@link LONG_SHAPE}, the default.** `responses.csv` carries the metadata
 *   columns and every question **outside** a group, exactly as it always did, plus
 *   one extra file per group at the group's own grain
 *   (`session_id, instance_ordinal, instance_id, <member questions>`), one row per
 *   `(session, live instance)`. A form with at least one group downloads as a zip
 *   of those files; a form with none downloads exactly the single file it exported
 *   before, so no existing adopter's pipeline moves.
 * - **{@link WIDE_SHAPE}, an option.** One flat `responses.csv`, with each group's
 *   member questions folded back in as indexed columns, `q_passport__1` through
 *   `q_passport__<max>`. Columns past a session's live instance count are empty.
 *
 * ## What the wide shape costs, documented here rather than discovered
 *
 * **A wide export's header depends on the version's `max`, not on the data, and it
 * changes when `max` changes.** A group with `max: 500` produces 500 columns per
 * member question whether any session filled two of them or none, and raising a
 * group's `max` in a later form version gives that version's wide export more
 * columns - silently, from a consumer's point of view. Under SEC-16 there is no
 * installation-wide ceiling above `max` (Q14), so nothing stops an author
 * declaring the 500 that produces 2000 columns for a four-question group; that is
 * what makes this paragraph load-bearing rather than cautionary.
 *
 * The existing `version` requirement is what makes a wide export automatable at
 * all, and it is the whole mitigation: **a consumer who automates a wide export
 * pins the version it bound to.** A consumer that wants a header which does not
 * move takes the long shape, which is why the long shape is the default and the
 * one the export screen offers first.
 */

import {
  countBounds,
  isRepeatGroup,
  stepQuestionRefs,
  type FormDefinition,
  type RepeatGroup,
} from "@roonga/qcms-core";
import { csvField } from "@roonga/qcms-csv";

/**
 * Re-exported so this module stays the one place the export's field encoding is
 * read from: the quoting policy and the guard are a property of the export, and
 * a reader of this file should not have to know which package implements them.
 */
export { csvField };

/** UTF-8 byte-order mark - see the module note on Excel interop. */
export const UTF8_BOM = "﻿";

/** RFC 4180 record separator. */
export const CRLF = "\r\n";

/** The fixed metadata columns emitted before the per-question columns. */
export const METADATA_COLUMNS = ["session_id", "form_version", "submitted_at", "access_mode"];

/**
 * The fixed metadata columns of a **group file**, which are not the response
 * file's: a group row is identified by its session and by which instance it is.
 *
 * `instance_ordinal` is the 1-based position in the session's live roster and is
 * what makes the file readable by a human; `instance_id` is the stable join key
 * and is what makes it joinable against `reporting.answers_flat`. Both, because
 * neither does the other's job: an ordinal is not stable across a removal and an
 * `ins_` id is not something an operator can sort passengers by.
 */
export const GROUP_METADATA_COLUMNS = ["session_id", "instance_ordinal", "instance_id"];

/** The two CSV shapes (Q17). `long` is the default everywhere it is offered. */
export const LONG_SHAPE = "long";
export const WIDE_SHAPE = "wide";
export const EXPORT_SHAPES = [LONG_SHAPE, WIDE_SHAPE] as const;
export type ExportShape = (typeof EXPORT_SHAPES)[number];

/** Whether a value is one of the two shapes, for a query parse. */
export function isExportShape(value: string): value is ExportShape {
  return (EXPORT_SHAPES as readonly string[]).includes(value);
}

/**
 * One column of the flat `responses.csv`: either a question outside every group,
 * or - in the wide shape only - one indexed slot of one member question.
 */
export type ResponseColumn =
  | { readonly header: string; readonly questionId: string }
  | {
      readonly header: string;
      readonly questionId: string;
      readonly groupId: string;
      /** 1-based instance slot; empty when the session has fewer live instances. */
      readonly index: number;
    };

/** One extra file of the long shape: a group, and its member questions in order. */
export interface GroupFileColumns {
  readonly groupId: string;
  readonly questionIds: readonly string[];
}

/**
 * The questionIds of a form definition in **document order**, group members
 * included: walk `steps` in order, and each step's `items` in order, expanding a
 * repeating group into its member refs.
 *
 * A questionId is pinned at most once across a form (a parse invariant, and
 * `DUPLICATE_QUESTION_IN_FORM` reaches inside groups), so the result is
 * duplicate-free. **That premise survived repetition and "one column per
 * question" did not** - see the module note - so this is no longer the export's
 * column list. It is the full pinned set, which is what a caller wanting "every
 * question this version asks" wants; {@link responseColumns} is what the export
 * projects onto.
 */
export function questionIdsInDocumentOrder(definition: FormDefinition): string[] {
  const ids: string[] = [];
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) ids.push(item.questionId);
  }
  return ids;
}

/**
 * How many indexed slots a group contributes per member question in the wide
 * shape: the group's declared `max` (a `fixed` count is its own bound).
 *
 * **Throws when a group declares no `max`.** Publish refuses that form with
 * `REPEAT_MAX_MISSING` (ADR-42, SEC-16), so a published version cannot reach here
 * without one and an absent `max` is a bug rather than an expected failure
 * (CONTRIBUTING: exceptions for bugs, typed results for expected failures). The
 * alternative - defaulting to the group's `min` - would emit a short header and
 * drop a respondent's trailing instances with no error, which is the exact class
 * of silent loss this task exists to remove.
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

/** `q_passport__3`: one indexed slot's header in the wide shape. */
export function indexedColumnHeader(questionId: string, index: number): string {
  return `${questionId}__${String(index)}`;
}

/**
 * The flat `responses.csv` columns for a version, in document order.
 *
 * In the long shape a group contributes **nothing** here - its answers are in its
 * own file - so for a form with no group the two shapes produce the same list, and
 * that list is the one the export has always emitted. That identity is what makes
 * "a form with no group is byte-identical in either shape" true by construction
 * rather than by coincidence.
 */
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

/**
 * One group's indexed columns in the wide shape: every member question's slot 1
 * through the group's `max`, members in document order.
 *
 * All the indices of one member question are consecutive (`q_passport__1` …
 * `q_passport__<max>`, then the next member's), which is the layout the plan names
 * and the one a spreadsheet user can read: a passport column block, not an
 * interleaving of passports and names.
 */
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

/**
 * The long shape's extra files: one per repeating group, in document order, each
 * named for its group and carrying its member questions in document order.
 *
 * Empty for a form with no group, which is what the route reads to decide between
 * a single `text/csv` response and a zip.
 */
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

/** The file name a group's rows are exported under, inside the zip. */
export function groupFileName(groupId: string): string {
  return `${groupId}.csv`;
}

/** The file name the flat response rows are exported under, inside the zip. */
export const RESPONSES_FILE_NAME = "responses.csv";

/**
 * One group's instances for one response, in the order
 * `reporting.responses.answers` holds them, which is the order the submission
 * froze: document order for questions, roster order for instances.
 *
 * Defensive about the shape rather than trusting it: the value is read out of
 * JSONB, and an export must not throw mid-stream on a row it does not recognise.
 * A missing or unexpected value is no instances, which exports as an absent group
 * row or an empty indexed cell.
 */
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

/** The key each instance object carries its own id under (migration 0025). */
const INSTANCE_ID_KEY = "instance_id";

/**
 * Serialize one canonical answer value to its CSV cell text (unquoted; quoting
 * is applied by {@link csvField}). Mirrors the canonical encodings (DOMAIN_SCHEMA
 * §2.4): strings verbatim, numbers/booleans stringified, multiChoice arrays
 * joined by `;`. A missing answer (`undefined`) is an empty cell.
 */
export function serializeAnswerForCsv(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(";");
  // Defensive: no canonical answer value is a plain object, but never throw mid-stream.
  return JSON.stringify(value);
}

/** The header record for a list of column headers, CRLF-terminated. */
function headerRow(fixed: readonly string[], headers: readonly string[]): string {
  return [...fixed, ...headers].map(csvField).join(",") + CRLF;
}

/** One flat column for a question outside every group. */
export function questionColumn(questionId: string): ResponseColumn {
  return { header: questionId, questionId };
}

/** The flat response file's header record (metadata + question columns). */
export function csvHeaderRow(columns: readonly ResponseColumn[]): string {
  return headerRow(
    METADATA_COLUMNS,
    columns.map((column) => column.header),
  );
}

/** One group file's header record. */
export function groupHeaderRow(file: GroupFileColumns): string {
  return headerRow(GROUP_METADATA_COLUMNS, file.questionIds);
}

/** The reporting-row fields both files' records are built from. */
export interface ExportRow {
  readonly sessionId: string;
  readonly formVersion: number;
  readonly submittedAt: Date;
  readonly accessMode: string;
  readonly answers: Record<string, unknown>;
}

/** One cell of the flat file, for a question column or an indexed group slot. */
function responseCell(row: ExportRow, column: ResponseColumn): string {
  if (!("groupId" in column)) return serializeAnswerForCsv(row.answers[column.questionId]);
  const instance = groupInstances(row.answers, column.groupId)[column.index - 1];
  // Past this session's live instance count the cell is empty, by design: the
  // header's width is the version's `max`, not this response's roster.
  return instance === undefined ? "" : serializeAnswerForCsv(instance[column.questionId]);
}

/** One data record of the flat response file, CRLF-terminated. */
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

/**
 * Every data record one response contributes to one group file: one per live
 * instance, CRLF-terminated, in roster order. The empty string when this response
 * has no instance of the group, which is an ordinary outcome rather than an error
 * - a group with `min: 0` and nothing added is a form filled in correctly.
 */
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
