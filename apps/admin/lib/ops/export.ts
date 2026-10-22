import type { ResponseFilterField } from "./response-filters.ts";
import { isTimeZone } from "../time-zone.ts";
import { dayEnd, dayFilter, dayStart, versionFilter } from "./response-filters.ts";

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
 *
 * The day boundary is borrowed too, since issue #312. `dayStart` and `dayEnd` were
 * defined here and the response browser's parser concatenated the same two suffixes
 * inline, which is the duplication the paragraph above argues against, carried by the
 * module making the argument. Both now come from `response-filters.ts`, beside the
 * `dayFilter` that decides what counts as a day in the first place.
 */

/** The formats the export route offers. */
export type ExportFormat = "csv" | "json";

/**
 * The two CSV shapes the API offers (Q17, ruled 2026-09-29 by the Code Owner).
 *
 * - **`long`**, the default: `responses.csv` for every question outside a repeating
 *   group, plus one file per group at its own grain. A form with a group downloads
 *   as a zip; a form with none downloads exactly the single file it always did.
 * - **`wide`**: one flat file with each group's member questions folded in as
 *   indexed columns, `q_passport__1` through `q_passport__<max>`.
 *
 * **The wide shape's header is the version's `max`, so it changes when `max`
 * changes.** That is why the dialog says so, in `ops.export.shapeWide`: an operator
 * automating a wide export has to pin the version their pipeline bound to, and an
 * operator who wants a header that does not move takes the long shape. The rule is
 * documented here, on the API route, and in `plan/repeating-groups-and-table-input.md`
 * section 5.5, because a consumer can meet it at any of the three.
 */
export type ExportShape = "long" | "wide";

/** The default shape, the same default the API applies when the parameter is absent. */
export const DEFAULT_EXPORT_SHAPE: ExportShape = "long";

/** What the export dialog collected. */
export interface ExportChoice {
  readonly format: ExportFormat;
  readonly version: string;
  readonly from: string;
  readonly to: string;
  /** Absent means the default, which is what a caller written before 075 sends. */
  readonly shape?: ExportShape;
  /**
   * The IANA zone the two days are whole days in: the operator's, so the range matches the
   * rows they read (Code Owner, 2026-10-19). Absent means UTC.
   */
  readonly timeZone?: string;
}

/** Whether a version must be chosen before this format can be exported. */
export function versionRequired(format: ExportFormat): boolean {
  return format === "csv";
}

/** Whether the shape control applies at all: CSV has two shapes, JSON has one. */
export function shapeApplies(format: ExportFormat): boolean {
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
  // `shape` is dropped for JSON for the reason `version` is: switching format must
  // not smuggle a parameter whose control the dialog is showing as disabled.
  if (shapeApplies(choice.format) && choice.shape !== undefined) {
    search.set("shape", choice.shape);
  }
  // The days are widened in the operator's zone, and the zone rides beside them so the
  // route can check the instants are whole days on that clock (`parseExportFilters`).
  const zone = isTimeZone(choice.timeZone) ? choice.timeZone : "UTC";
  const from = choice.from.trim();
  const to = choice.to.trim();
  if (from !== "") search.set("from", dayStart(from, zone));
  if (to !== "") search.set("to", dayEnd(to, zone));
  if ((from !== "" || to !== "") && zone !== "UTC") search.set("tz", zone);
  return `?${search.toString()}`;
}

/**
 * The filename the download is offered under.
 *
 * The form id, the **environment**, and the format, plus the version when there is one,
 * so two exports of the same form at different versions do not overwrite each other in a
 * downloads folder. No timestamp: it would make the name unstable between two exports of
 * the same data, which is worse for an operator diffing them.
 *
 * **The environment is in the name and in no column** (Q8, ADR-40, task 067). An export
 * reads one environment's pool, so a file can never mix two and a column would change a
 * file adopters parse for no information the name does not already carry. What it answers
 * is the operator's question rather than the consumer's: which environment the file on
 * their desktop came from. Before this, two environments' exports of one form and version
 * were the same name, and a report built from the wrong one looked exactly like a report
 * built from the right one.
 *
 * It must be the environment the **API read**, not a second opinion about it: the caller
 * passes `currentEnvironment()`, which is the same cookie `adminApiFetch` builds the
 * `x-qcms-environment` header from, so the name and the rows cannot disagree. The API
 * names its own stream the same way (`responseExportFileName` in `@roonga/qcms-csv`); this
 * one is what the browser saves, because this route re-names the download to settle the
 * extension (see {@link exportExtension}).
 */
export function exportFilename(
  formId: string,
  environment: string,
  choice: ExportChoice,
  extension: ExportExtension = choice.format,
): string {
  const version =
    versionRequired(choice.format) && choice.version !== "" ? `-v${choice.version}` : "";
  return `${formId}-${environment}${version}-responses.${extension}`;
}

/** The extensions a finished export can land under. */
export type ExportExtension = "csv" | "json" | "zip";

/**
 * The extension the download should carry, read from what the API actually sent.
 *
 * Needed since task 075, because the long shape of a form with a repeating group is
 * **several files in a zip** and this app cannot tell from the request which it will
 * get: whether a version has a group is a property of the pinned definition, which
 * only the API has read. Naming the file from the request would offer a `.csv` whose
 * bytes are an archive, and an operator would open it in a spreadsheet and see
 * nothing. So the upstream's own `content-type` decides, and a type this function
 * does not recognise falls back to the requested format rather than guessing.
 */
export function exportExtension(format: ExportFormat, contentType: string | null): ExportExtension {
  return contentType !== null && contentType.startsWith("application/zip") ? "zip" : format;
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
 * to carry `2026-07-01`. Both are accepted and both mean the same whole day in the zone the
 * `tz` parameter names (UTC when it names none, which is what every link written before the
 * 2026-10-19 ruling meant); the request is always built from the widened form, because that
 * is what the API reads.
 *
 * A partial instant such as `to=2026-07-01T12:00:00.000Z` is refused even though the
 * API would accept it. The export's unit is a day everywhere it is offered - in the
 * dialog's controls, in the browser's toolbar, in `dayStart`/`dayEnd` - and honouring a
 * half-day here would be the second answer this function exists to prevent.
 */
export function parseExportFilters(query: URLSearchParams): ExportFilterParse {
  const rawZone = query.get("tz") ?? "";
  const zone = isTimeZone(rawZone) ? rawZone : "UTC";
  const parsed = {
    version: versionFilter(query.get("version") ?? ""),
    from: boundFilter(query.get("from") ?? "", "from", zone),
    to: boundFilter(query.get("to") ?? "", "to", zone),
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
 * One end of the range: the whole day it names in `zone`, widened back to the instant the
 * API filters on, or `undefined` if it names no day.
 *
 * The round trip through `dayFilter` is what rejects `2026-02-31`, which is day-shaped
 * and does not exist. Comparing against the widened form rather than pattern-matching
 * the time part is what rejects a partial instant without a second regex to keep in
 * step with `dayStart`/`dayEnd`.
 */
function boundFilter(value: string, bound: "from" | "to", zone: string): string | undefined {
  const widen = (day: string) => (bound === "from" ? dayStart(day, zone) : dayEnd(day, zone));
  // The day an instant names is its local day in `zone`, which is not always its first ten
  // characters: Sydney's first instant of 1 July is 30 June in UTC. So a full instant is
  // accepted only when it is exactly the widening of the day on either side of its UTC date.
  const day = DAY_PREFIX.test(value) && value.length === 10 ? value : localDayOf(value, widen);
  if (day === undefined) return undefined;
  const valid = dayFilter(day);
  return valid === undefined ? undefined : widen(valid);
}

const DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/** The day whose widening is exactly `value`, or `undefined` when it is a partial instant. */
function localDayOf(value: string, widen: (day: string) => string): string | undefined {
  if (!DAY_PREFIX.test(value)) return undefined;
  const utcDay = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(utcDay)) return undefined;
  for (const shift of [0, 1, -1]) {
    const candidate = new Date(utcDay + shift * 86_400_000).toISOString().slice(0, 10);
    if (widen(candidate) === value) return candidate;
  }
  return undefined;
}
