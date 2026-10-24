/**
 * The name a response export downloads under (ADR-40).
 *
 * The environment is in the name and in no column: an export reads one
 * environment's pool, so a row can never be ambiguous, and what an operator
 * needs to tell apart is the file on their desktop. A column would change a
 * file adopters parse for information the name already carries.
 *
 * It is a module rather than a template string because there are three of these
 * names, and the way three templates drift is that one loses the environment and
 * an operator ends up holding two files with the same name.
 *
 * The version stays beside `responses`, which is the pair an existing pipeline's
 * glob is written around, and the environment goes in front of it, where a
 * reader's eye lands after the id.
 *
 * Every part is machine text: a branded form id, an environment name that has
 * passed its own pattern, and an integer. No respondent string reaches it, which
 * is what keeps a `Content-Disposition` header free of anything needing escaping
 * or redaction (SEC-8).
 */

export interface ResponseExportName {
  readonly formId: string;
  readonly environment: string;
  /** Absent for the shapes that may span versions. */
  readonly version?: number | undefined;
  readonly extension: "csv" | "zip" | "json";
}

/**
 * The version is optional rather than this being two functions, because the CSV
 * shapes require one, the JSON shape may span them, and the name reads the same
 * way either way.
 */
export function responseExportFileName(input: ResponseExportName): string {
  const version = input.version === undefined ? "" : `-v${String(input.version)}`;
  return `${input.formId}-${input.environment}${version}-responses.${input.extension}`;
}
