import type { ResponseFilterField } from "./response-filters.ts";
import { dayFilter, versionFilter } from "./response-filters.ts";

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
 *
 * Since issue 551 the module owns both ends of that link: {@link exportQuery} writes it
 * and {@link parseExportFilters} reads it back, so the shapes cannot drift apart. The
 * validation itself is borrowed rather than invented - see {@link parseExportFilters}.
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

/**
 * The three filters an export URL may carry: the response browser's set without
 * `flagged`, which the export endpoint does not take.
 *
 * Typed as a subset of the browser's field union rather than a fresh union, so renaming
 * a filter there is a compile error here instead of a silent second vocabulary.
 */
export type ExportFilterField = Extract<ResponseFilterField, "version" | "from" | "to">;

/** The fields, in the order the dialog shows them and a refusal names them. */
export const EXPORT_FILTER_FIELDS = [
  "version",
  "from",
  "to",
] as const satisfies readonly ExportFilterField[];

/** The filters as `exportResponses` takes them: absent, or a value the API accepts. */
export interface ExportFilters {
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
}

/** A validated export URL, or the parameters that stopped it being one. */
export type ExportFilterParse =
  | { readonly ok: true; readonly filters: ExportFilters }
  | { readonly ok: false; readonly invalid: readonly ExportFilterField[] };

/**
 * Read the export URL's filters, with the response browser's validators (issue 551).
 *
 * ## Nothing new is decided about what a filter is
 *
 * `versionFilter` and `dayFilter` come from `response-filters.ts`, so a value the
 * response browser would keep is a value this export applies, and one it would drop is
 * one this export will not send. Before this, the route forwarded all three parameters
 * verbatim and the two screens could disagree about the same querystring.
 *
 * ## What it refuses, and why refusing rather than ignoring
 *
 * The browser drops an unreadable filter, applies the rest, and names what it dropped
 * in a notice beside the table. This does the opposite: one bad parameter refuses the
 * whole export. The difference is not an oversight, it is the surface. An export
 * renders nothing, so there is no notice to put a caveat in, and what it produces is a
 * file that leaves the app entirely - saved, mailed, opened next quarter by someone who
 * never saw the URL. A CSV silently covering the whole form when its requester wrote a
 * March range is a false claim with no expiry, and it is exactly the class of untruth
 * issue 521 removed from the screen next door. An error the operator reads immediately,
 * and can fix, is the smaller harm.
 *
 * ## Days, in either spelling
 *
 * `exportQuery` widens a chosen day to the instant it begins or ends, so the link the
 * dialog builds carries `2026-07-01T00:00:00.000Z`, while a hand-typed URL is likelier
 * to carry `2026-07-01`. Both are accepted and both mean the same whole UTC day; the
 * request is always built from the widened form, because that is what the API reads.
 *
 * A partial instant such as `to=2026-07-01T12:00:00.000Z` is refused even though the
 * API would accept it. The export's unit is a day everywhere it is offered - in the
 * dialog's controls, in the browser's toolbar, in `dayStart`/`dayEnd` - and honouring a
 * half-day here would be the second answer this function exists to prevent.
 */
export function parseExportFilters(query: URLSearchParams): ExportFilterParse {
  const parsed = {
    version: versionFilter(query.get("version") ?? ""),
    from: boundFilter(query.get("from") ?? "", "from"),
    to: boundFilter(query.get("to") ?? "", "to"),
  } as const;

  // An absent or empty parameter is no filter and no complaint, exactly as it is on the
  // response browser; only a value that was written and cannot be read is a refusal.
  const invalid = EXPORT_FILTER_FIELDS.filter(
    (field) => (query.get(field) ?? "") !== "" && parsed[field] === undefined,
  );
  if (invalid.length > 0) return { ok: false, invalid };

  return {
    ok: true,
    filters: {
      ...(parsed.version === undefined ? {} : { version: parsed.version }),
      ...(parsed.from === undefined ? {} : { from: parsed.from }),
      ...(parsed.to === undefined ? {} : { to: parsed.to }),
    },
  };
}

/**
 * One end of the range: the whole UTC day it names, widened back to the instant the API
 * filters on, or `undefined` if it names no day.
 *
 * The round trip through `dayFilter` is what rejects `2026-02-31`, which is day-shaped
 * and does not exist. Comparing against the widened form rather than pattern-matching
 * the time part is what rejects a partial instant without a second regex to keep in
 * step with `dayStart`/`dayEnd`.
 */
function boundFilter(value: string, bound: "from" | "to"): string | undefined {
  const widen = bound === "from" ? dayStart : dayEnd;
  const day = value.slice(0, 10);
  if (value !== day && value !== widen(day)) return undefined;
  const valid = dayFilter(day);
  return valid === undefined ? undefined : widen(valid);
}
