/**
 * CSV field serialization shared by every QCMS export (issue #470).
 *
 * QCMS emits two CSV files from two different apps: the response export
 * (`apps/api`, task 023) and the minted-link batch export (`apps/admin`, task
 * 034). Both are downloaded by an operator and opened in a spreadsheet, so both
 * need the same two protections. They used to carry a function of the same name
 * each, and the copies had already diverged: the guard below existed only on the
 * link export, whose fields are server-generated, while the export carrying
 * respondent free text had none. One module, so a third copy cannot happen.
 *
 * Two protections, in this order:
 *
 * 1. **The formula-injection guard.** Several spreadsheet programs evaluate a
 *    cell whose first character is `=`, `+`, `-` or `@` on open, and treat a
 *    leading tab or CR as whitespace before one of those. A cell that starts
 *    with any of them is prefixed with a single quote, which makes it inert.
 *    This matters most where a cell is attacker-controlled by design: a
 *    respondent types their answer into a public portal and the form author is
 *    the one who opens the file.
 * 2. **RFC 4180 quoting** (RFC 4180 sections 2.5-2.7): a field containing a
 *    comma, a double quote, CR or LF is wrapped in double quotes, and embedded
 *    double quotes are doubled.
 *
 * The two exports differ, deliberately, on *when* to quote, which is why this
 * module offers both policies rather than collapsing them:
 *
 * - {@link csvField} quotes only when the field requires it. The response
 *   export's byte-level contract is pinned by a golden test, and bare fields are
 *   part of it.
 * - {@link csvFieldAlwaysQuoted} quotes every field. The link export chose that
 *   so a field that grows a separator later cannot silently shift a column.
 *
 * The guard runs first in both, and never changes the quoting decision: the only
 * character it can add is an apostrophe, which is not one that forces quoting.
 *
 * Cell contents are export payload and are never logged (SEC-8): nothing here
 * takes a logger, and callers must not add one.
 */

/**
 * The leading characters a spreadsheet may read as the start of a formula.
 *
 * Tab and CR are in the set because a leading run of them is whitespace to a
 * spreadsheet, so `\t=CMD(...)` is the same cell as `=CMD(...)` once trimmed.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** The characters that oblige RFC 4180 quoting. */
const MUST_QUOTE = /[",\r\n]/;

/**
 * Make a cell inert for a spreadsheet, leaving every other cell byte-identical.
 *
 * Note what this does not do: it does not strip, escape or validate the content.
 * The cell keeps its exact text and gains one leading apostrophe, so the answer
 * an author reads is still the answer the respondent gave.
 */
function guardFormulaLead(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

/** Wrap a field in double quotes, doubling any it contains (RFC 4180 section 2.7). */
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * One CSV field, guarded against formula injection and quoted **only when RFC
 * 4180 requires it**.
 *
 * Single-argument by design: both call sites pass this straight to `Array.map`,
 * which would feed an index into any second parameter.
 */
export function csvField(value: string): string {
  const guarded = guardFormulaLead(value);
  return MUST_QUOTE.test(guarded) ? quote(guarded) : guarded;
}

/**
 * One CSV field, guarded against formula injection and **always** quoted.
 *
 * The always-quote policy is a column-stability choice, not a correctness one:
 * an export whose fields are all quoted cannot start shifting columns the day a
 * field grows a comma.
 */
export function csvFieldAlwaysQuoted(value: string): string {
  return quote(guardFormulaLead(value));
}
