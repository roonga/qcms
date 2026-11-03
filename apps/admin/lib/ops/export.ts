import type { ResponseFilterField } from "./response-filters.ts";
import { isTimeZone } from "../time-zone.ts";
import { dayEnd, dayFilter, dayStart, versionFilter } from "./response-filters.ts";

/** CSV needs a version to define its columns; JSON records carry their own version. Share validation and day boundaries with the response browser. */

export type ExportFormat = "csv" | "json";

/** Long group exports may be archives; wide headers depend on the frozen group maximum, so consumers must pin the version. */
export type ExportShape = "long" | "wide";

export const DEFAULT_EXPORT_SHAPE: ExportShape = "long";

export interface ExportChoice {
  readonly format: ExportFormat;
  readonly version: string;
  readonly from: string;
  readonly to: string;

  readonly shape?: ExportShape;
  /** The address supplies the day zone; absent means UTC. */
  readonly timeZone?: string;
}

export function versionRequired(format: ExportFormat): boolean {
  return format === "csv";
}

export function shapeApplies(format: ExportFormat): boolean {
  return format === "csv";
}

export function isExportable(choice: ExportChoice): boolean {
  return !versionRequired(choice.format) || choice.version.trim() !== "";
}

/** Omit empty instant controls and drop version for JSON so disabled fields cannot silently filter exports. */
export function exportQuery(choice: ExportChoice): string {
  const search = new URLSearchParams({ format: choice.format });
  if (versionRequired(choice.format) && choice.version.trim() !== "") {
    search.set("version", choice.version.trim());
  }
  /** Drop CSV shape for JSON so disabled controls cannot smuggle parameters. */
  if (shapeApplies(choice.format) && choice.shape !== undefined) {
    search.set("shape", choice.shape);
  }

  const zone = isTimeZone(choice.timeZone) ? choice.timeZone : "UTC";
  const from = choice.from.trim();
  const to = choice.to.trim();
  if (from !== "") search.set("from", dayStart(from, zone));
  if (to !== "") search.set("to", dayEnd(to, zone));
  if ((from !== "" || to !== "") && zone !== "UTC") search.set("tz", zone);
  return `?${search.toString()}`;
}

/** Name the environment actually read by the API, not a second selection. Keep environment in the filename rather than adding a redundant wire column. */
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

export type ExportExtension = "csv" | "json" | "zip";

/** Use upstream content-type for the extension: group long exports may be ZIP bytes even when the request selected CSV. */
export function exportExtension(format: ExportFormat, contentType: string | null): ExportExtension {
  return contentType !== null && contentType.startsWith("application/zip") ? "zip" : format;
}

/** Reuse browser filter names as a subset so renames fail at compile time. */
export type ExportFilterField = Extract<ResponseFilterField, "version" | "from" | "to">;

export const EXPORT_FILTER_FIELDS = [
  "version",
  "from",
  "to",
] as const satisfies readonly ExportFilterField[];

export interface ExportFilters {
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
}

export type ExportFilterParse =
  | { readonly ok: true; readonly filters: ExportFilters }
  | { readonly ok: false; readonly invalid: readonly ExportFilterField[] };

/** Reject the whole export on malformed filters because a downloaded file cannot carry an ignored-filter caveat. Accept whole days only, in the address zone; reject partial instants. */
export function parseExportFilters(query: URLSearchParams): ExportFilterParse {
  const rawZone = query.get("tz") ?? "";
  const zone = isTimeZone(rawZone) ? rawZone : "UTC";
  const parsed = {
    version: versionFilter(query.get("version") ?? ""),
    from: boundFilter(query.get("from") ?? "", "from", zone),
    to: boundFilter(query.get("to") ?? "", "to", zone),
  } as const;

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

/** Round-trip through day validation and widening to reject nonexistent dates and partial-day instants. */
function boundFilter(value: string, bound: "from" | "to", zone: string): string | undefined {
  const widen = (day: string) => (bound === "from" ? dayStart(day, zone) : dayEnd(day, zone));
  /** A local day can begin on a different UTC date; accept instants only if they exactly match a day boundary in the named zone. */
  const day = DAY_PREFIX.test(value) && value.length === 10 ? value : localDayOf(value, widen);
  if (day === undefined) return undefined;
  const valid = dayFilter(day);
  return valid === undefined ? undefined : widen(valid);
}

const DAY_PREFIX = /^\d{4}-\d{2}-\d{2}/;

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
