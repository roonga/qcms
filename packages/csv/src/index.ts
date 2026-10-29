/**
 * CSV field serialization shared by every QCMS export. The formula-injection guard runs
 * first (a leading `=`, `+`, `-` or `@` gains an apostrophe; {@link NUMERIC_LITERAL} is
 * exempt), then RFC 4180 quoting. Cell contents are never logged (SEC-8).
 */

export * from "./zip.js";

export * from "./file-name.js";

/**
 * The leading characters a spreadsheet may read as the start of a formula. Tab
 * and CR are in the set: a spreadsheet trims them, so `\t=CMD(...)` is the same
 * cell as `=CMD(...)`.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** The characters that oblige RFC 4180 quoting. */
const MUST_QUOTE = /[",\r\n]/;

/**
 * A plain decimal number, exempt from the guard. A leading `+` is not exempt, as a
 * spreadsheet may coerce it into a formula. Too wide a pattern ships a live formula.
 */
const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

/**
 * Makes a cell inert, leaving every other cell byte-identical. Strips, escapes
 * and validates nothing: the cell gains one leading apostrophe and keeps its
 * exact text, so the answer an author reads is the answer given.
 */
function guardFormulaLead(value: string): string {
  if (!FORMULA_LEAD.test(value)) return value;
  if (NUMERIC_LITERAL.test(value)) return value;
  return `'${value}`;
}

/** RFC 4180 section 2.7. */
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * One CSV field, guarded and quoted only where RFC 4180 requires it: the
 * response export's bare fields are part of a byte-level golden contract.
 * Single-argument by design, a call site passing it straight to `Array.map`.
 */
export function csvField(value: string): string {
  const guarded = guardFormulaLead(value);
  return MUST_QUOTE.test(guarded) ? quote(guarded) : guarded;
}

/**
 * One CSV field, guarded and always quoted. Column stability rather than
 * correctness: an all-quoted export cannot shift columns the day a field grows
 * a comma.
 */
export function csvFieldAlwaysQuoted(value: string): string {
  return quote(guardFormulaLead(value));
}
