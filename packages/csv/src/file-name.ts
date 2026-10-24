/**
 * The name a response export downloads under (ADR-40). The environment is in the
 * name and in no column: an export reads one environment's pool, so what an
 * operator needs to tell apart is the file on their desktop. `responses` stays
 * beside the version, the pair an existing pipeline's glob is written around.
 *
 * Every part is machine text, so no respondent string reaches a
 * `Content-Disposition` header (SEC-8).
 */

export interface ResponseExportName {
  readonly formId: string;
  readonly environment: string;
  /** Absent for the shapes that may span versions. */
  readonly version?: number | undefined;
  readonly extension: "csv" | "zip" | "json";
}

/** Optional, not two functions: the CSV shapes require it, the JSON one may span versions. */
export function responseExportFileName(input: ResponseExportName): string {
  const version = input.version === undefined ? "" : `-v${String(input.version)}`;
  return `${input.formId}-${input.environment}${version}-responses.${input.extension}`;
}
