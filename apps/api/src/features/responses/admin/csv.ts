/**
 * CSV export serialization (task 023) — pure, fetch-pure (R4) string helpers.
 *
 * The CSV export projects `reporting.responses` rows onto **one column per
 * questionId of the requested form version**, in **document order** (the order
 * the questionIds appear walking `steps` then `items` in the frozen definition).
 * Because the column set depends on the version's shape, the export route
 * requires a `version` parameter.
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
 * - **multiChoice** is serialized as its option ids joined by `;` (e.g.
 *   `opt_a;opt_b;opt_c`) — a single CSV field, documented, so the `,` delimiter
 *   is never ambiguous with a selection separator.
 * - A question with **no answer** in a given response is an empty field.
 *
 * Answer *values* are export payload, never logged (SEC-8).
 */

import type { FormDefinition } from "@qcms/core";

/** UTF-8 byte-order mark — see the module note on Excel interop. */
export const UTF8_BOM = "﻿";

/** RFC 4180 record separator. */
export const CRLF = "\r\n";

/** The fixed metadata columns emitted before the per-question columns. */
export const METADATA_COLUMNS = ["session_id", "form_version", "submitted_at", "access_mode"];

/**
 * The questionIds of a form definition in **document order**: walk `steps` in
 * order, and each step's `items` in order. A questionId is pinned at most once
 * across a form (a parse invariant), so the result is duplicate-free.
 */
export function questionIdsInDocumentOrder(definition: FormDefinition): string[] {
  const ids: string[] = [];
  for (const step of definition.steps) {
    for (const item of step.items) ids.push(item.questionId);
  }
  return ids;
}

/** Quote a single CSV field per RFC 4180, only when it must be quoted. */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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

/** The header record (metadata columns + question columns), CRLF-terminated. */
export function csvHeaderRow(questionColumns: readonly string[]): string {
  const cells = [...METADATA_COLUMNS, ...questionColumns].map(csvField);
  return cells.join(",") + CRLF;
}

/** One data record for a reporting row, CRLF-terminated. */
export function csvDataRow(
  row: {
    sessionId: string;
    formVersion: number;
    submittedAt: Date;
    accessMode: string;
    answers: Record<string, unknown>;
  },
  questionColumns: readonly string[],
): string {
  const meta = [
    row.sessionId,
    String(row.formVersion),
    row.submittedAt.toISOString(),
    row.accessMode,
  ];
  const questionCells = questionColumns.map((qid) => serializeAnswerForCsv(row.answers[qid]));
  return [...meta, ...questionCells].map(csvField).join(",") + CRLF;
}
