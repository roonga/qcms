/**
 * CSV field serialization shared by every QCMS export. One module because the
 * two exports once carried a copy each and the copies had diverged: the guard
 * reached the server-generated export and not the one carrying respondent text.
 *
 * The formula-injection guard runs first: a spreadsheet evaluates a cell opening
 * with `=`, `+`, `-` or `@`, so such a cell gains an apostrophe and goes inert.
 * {@link NUMERIC_LITERAL} is the one exemption. Then RFC 4180 quoting; the two
 * exports differ on when to quote, which is why both policies live here.
 *
 * Cell contents are export payload and are never logged (SEC-8): nothing here
 * takes a logger, and a caller must not add one.
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
 * A plain decimal number, exempt from the guard: it carries no operator,
 * function name or reference, and prefixing it would reach the author as text
 * they cannot sum. A leading `+` is not exempt, at least one spreadsheet
 * coercing it into a formula. Anchored at both ends, a formula being able to
 * open numeric-looking. Too wide a pattern here ships a live formula.
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
