/**
 * The export request, decided in one place (task 035).
 *
 * Two rules the export UI has to enforce before it can send anything, both of them
 * the API's and neither of them invented here:
 *
 * - **CSV needs a version.** The CSV column set is one column per questionId of a
 *   *specific* form version in document order, so without a version there is no
 *   header row to write and the API answers 400. The dialog therefore disables the
 *   download rather than letting an author discover that from an error.
 * - **JSON does not.** Its records carry their own `formVersion`, so the version
 *   control is disabled with a hint instead of being hidden, which keeps the two
 *   formats' controls in the same place.
 *
 * Kept as pure functions so both the dialog (deciding what to enable) and the route
 * handler (building the upstream call) read the same rule, and so it is unit-tested
 * without a browser.
 */

/** The formats the export route offers. */
export type ExportFormat = "csv" | "json";

/** What the export dialog collected. */
export interface ExportChoice {
  readonly format: ExportFormat;
  readonly version: string;
  readonly from: string;
  readonly to: string;
}

/** Whether a version must be chosen before this format can be exported. */
export function versionRequired(format: ExportFormat): boolean {
  return format === "csv";
}

/** Whether the collected choice can be sent as-is. */
export function isExportable(choice: ExportChoice): boolean {
  return !versionRequired(choice.format) || choice.version.trim() !== "";
}

/**
 * The query string for the admin's own export route.
 *
 * Empty controls are omitted rather than sent blank: the API parses `from`/`to` as
 * instants and an empty string is not one. `version` is dropped for JSON even if the
 * control happens to hold a value, so switching format cannot smuggle a filter the
 * dialog is showing as disabled.
 */
export function exportQuery(choice: ExportChoice): string {
  const search = new URLSearchParams({ format: choice.format });
  if (versionRequired(choice.format) && choice.version.trim() !== "") {
    search.set("version", choice.version.trim());
  }
  if (choice.from.trim() !== "") search.set("from", dayStart(choice.from.trim()));
  if (choice.to.trim() !== "") search.set("to", dayEnd(choice.to.trim()));
  return `?${search.toString()}`;
}

/**
 * Widen a chosen calendar day to the instant it begins / ends, in UTC.
 *
 * The same decision `endOfDay` records for link expiry, and for the same reason: the
 * controls ask for a day because that is the question an operator has, the API wants
 * an instant, and doing the widening in the operator's local zone would make the
 * exported set depend on the machine it was exported from. UTC is what every
 * timestamp on these screens is rendered in (`lib/i18n/format.ts`), so the filter and
 * the column agree. A value that already carries a time passes through untouched.
 */
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function dayStart(value: string): string {
  return DAY_ONLY.test(value) ? `${value}T00:00:00.000Z` : value;
}

export function dayEnd(value: string): string {
  return DAY_ONLY.test(value) ? `${value}T23:59:59.999Z` : value;
}

/**
 * The filename the download is offered under.
 *
 * The form id and the format, plus the version when there is one, so two exports of
 * the same form at different versions do not overwrite each other in a downloads
 * folder. No timestamp: it would make the name unstable between two exports of the
 * same data, which is worse for an operator diffing them.
 */
export function exportFilename(formId: string, choice: ExportChoice): string {
  const version =
    versionRequired(choice.format) && choice.version !== "" ? `-v${choice.version}` : "";
  return `${formId}${version}-responses.${choice.format}`;
}
