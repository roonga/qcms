/**
 * The name a response export downloads under (Q8, ADR-40; task 067).
 *
 * # Why the environment is in the name and in no column
 *
 * An export is **per environment already**: it reads one environment's pool, so one file
 * can never mix two. The question Q8 answers is therefore not "how does a consumer tell
 * which environment a row came from" - a row cannot be ambiguous - but "how does an
 * operator tell which environment the file on their desktop came from", and the answer is
 * the name of the file they downloaded. Putting it in a **column** would change a file
 * adopters parse, for no information they do not already have from the name, and the
 * columns are byte-for-byte what they were (criterion 3).
 *
 * The one thing that makes this worth a module rather than a template string at the call
 * site is that there are **three** of these names, for CSV, for the zip of the long shape
 * and for JSON, and a fourth one day. Three templates drift, and the way they drift is
 * that one of them loses the environment and nobody notices until an operator is holding
 * two files called the same thing.
 *
 * # Where the environment sits in the name
 *
 * After the form id and before the version: `frm_x-prod-v3-responses.csv`. The version
 * stays next to `responses` because `v3-responses` is the pair an existing pipeline's
 * glob is written around, and the environment goes in front of it because that is where a
 * reader's eye lands after the id. A name is sorted and read by people, so the order is
 * most-stable-first.
 *
 * # It is a file name and is never user input
 *
 * Every part is machine text: a branded form id, an environment name that has passed
 * `^[a-z][a-z0-9]*$` (Q42), and an integer. There is no respondent string anywhere in it,
 * which is what keeps a `Content-Disposition` header free of anything that would need
 * escaping or redacting (SEC-8).
 */

/** What a response export's name is built from. */
export interface ResponseExportName {
  /** The branded form id, which leads the name. */
  readonly formId: string;
  /** The environment the export was read from (Q8). */
  readonly environment: string;
  /** The pinned form version, for the shapes that require one. */
  readonly version?: number | undefined;
  /** `csv`, `zip` or `json`. */
  readonly extension: "csv" | "zip" | "json";
}

/**
 * `frm_x-prod-responses.json`, or `frm_x-prod-v3-responses.csv` when a version is pinned.
 *
 * The CSV shapes require a version and the JSON shape may span them, which is why the
 * version is optional here rather than two functions: the caller that has one passes it,
 * and the name reads the same way either way.
 */
export function responseExportFileName(input: ResponseExportName): string {
  const version = input.version === undefined ? "" : `-v${String(input.version)}`;
  return `${input.formId}-${input.environment}${version}-responses.${input.extension}`;
}
