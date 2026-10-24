/**
 * CSV field serialization shared by every QCMS export. One module, because the
 * two exports once carried a copy each and the copies had diverged: the guard
 * below reached the server-generated export and not the one carrying respondent
 * free text.
 *
 * Two protections, in this order.
 *
 * The formula-injection guard: several spreadsheet programs evaluate a cell
 * whose first character is `=`, `+`, `-` or `@`, and read a leading tab or CR as
 * whitespace before one of those, so such a cell is prefixed with an apostrophe
 * to make it inert. It matters most where a cell is attacker-controlled by
 * design, a respondent typing into a public portal and the author opening the
 * file. {@link NUMERIC_LITERAL} is the one exemption.
 *
 * Then RFC 4180 quoting (sections 2.5 to 2.7). The two exports differ
 * deliberately on when to quote, which is why both policies live here rather
 * than being collapsed.
 *
 * The guard runs first in both and never changes the quoting decision, since an
 * apostrophe is not a character that forces quoting.
 *
 * Cell contents are export payload and are never logged (SEC-8): nothing here
 * takes a logger, and a caller must not add one.
 *
 * The package also carries the container a multi-file export needs, for the same
 * reason: the export's byte-level encoding is one thing in one place.
 */

export * from "./zip.js";

// The download name is here rather than at its three call sites for the reason
// the field helpers are: three templates drift, and the way they drift is that
// one loses the environment and an operator ends up holding two files with the
// same name.
export * from "./file-name.js";

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
 * A plain decimal number, whole-string, which is exempt from the guard: after
 * the optional sign it carries no operator, function name or reference, so it
 * cannot be evaluated as an expression, and prefixing it would reach the author
 * as text they cannot sum.
 *
 * A negative sign is the only lead this exempts in practice. A leading `+` is
 * coerced into a formula by at least one spreadsheet, so a positive number is
 * not a safe shape.
 *
 * Anchored at both ends rather than written as a prefix test, because a formula
 * can open numeric-looking. The pattern stays narrow deliberately: too narrow
 * costs a cosmetic apostrophe on an absurd value, too wide ships a live formula.
 */
const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

/**
 * Makes a cell inert, leaving every other cell byte-identical. It strips,
 * escapes and validates nothing: the cell keeps its exact text and gains one
 * leading apostrophe, so the answer an author reads is the answer given.
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
 * One CSV field, guarded and quoted only where RFC 4180 requires it, because
 * the response export's bare fields are part of a byte-level golden contract.
 *
 * Single-argument by design: a call site passes this straight to `Array.map`,
 * which would feed an index into any second parameter.
 */
export function csvField(value: string): string {
  const guarded = guardFormulaLead(value);
  return MUST_QUOTE.test(guarded) ? quote(guarded) : guarded;
}

/**
 * One CSV field, guarded and always quoted. A column-stability choice rather
 * than a correctness one: an export whose fields are all quoted cannot start
 * shifting columns the day a field grows a comma.
 */
export function csvFieldAlwaysQuoted(value: string): string {
  return quote(guardFormulaLead(value));
}
