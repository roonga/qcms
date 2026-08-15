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
 *    the one who opens the file. One exemption, {@link NUMERIC_LITERAL}: a plain
 *    decimal number is not an expression, so a negative numeric answer exports
 *    as the number it is rather than as text (issue #476).
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
 * A plain decimal number, whole-string: optional minus, digits, at most one
 * fractional part. Such a value is **exempt** from the guard (issue #476).
 *
 * The argument is narrow and it is the only one: a string of this shape cannot
 * be evaluated as an expression, because after the optional sign it contains no
 * operator, no function name and no reference. So prefixing it protects nothing
 * and costs something real: `-5` would reach the author as the text `'-5`
 * instead of the number they are trying to sum.
 *
 * `-` is the only lead this can exempt in practice. A value starting `=`, `+`,
 * `@`, tab or CR never matches, which is deliberate: Excel coerces a leading `+`
 * into a formula (`+1` is `=+1`), so a "positive number" is not a safe shape.
 *
 * Everything below is **guarded**, each for a stated reason:
 *
 * - `-1+1`, `-1-1`, `--5`: formulas that merely open numeric-looking. `-1+1`
 *   evaluates to 0 in Excel. This is the pair the pattern exists to separate,
 *   and the reason it is anchored at both ends rather than a prefix test.
 * - `-5e3`, `-.5`: not shapes `String(n)` produces for a number a respondent
 *   could realistically answer (exponential form needs `|n| >= 1e21` or
 *   `< 1e-6`, and a bare leading `.` is never emitted at all). Admitting them
 *   would mean putting `+` and an optional-digit part into this pattern, which
 *   is precisely the widening that risks admitting `-1+1`. Being too narrow
 *   costs a cosmetic apostrophe on an absurd value; being too wide ships a live
 *   formula, so the tie breaks toward narrow.
 * - `- 5`, `-5abc`, and a lone `-`: not numbers, and `- 5` is a formula to Excel.
 *
 * Two shapes never reach this test at all, because they do not start with a
 * dangerous character and so are never guarded: `1_000` and `5-`.
 */
const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

/**
 * Make a cell inert for a spreadsheet, leaving every other cell byte-identical.
 *
 * Note what this does not do: it does not strip, escape or validate the content.
 * The cell keeps its exact text and gains one leading apostrophe, so the answer
 * an author reads is still the answer the respondent gave.
 */
function guardFormulaLead(value: string): string {
  if (!FORMULA_LEAD.test(value)) return value;
  if (NUMERIC_LITERAL.test(value)) return value;
  return `'${value}`;
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
