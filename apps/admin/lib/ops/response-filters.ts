import { endOfDayIn, isTimeZone, startOfDayIn } from "../time-zone.ts";
import type { AppliedFilters } from "./browse.ts";

/** Use one validated result for API filters, controls and empty states. Name ignored malformed values so the table cannot silently claim a requested range. Shared links carry their zone; absent or unknown means UTC. */

export const RESPONSE_FILTER_FIELDS = ["version", "from", "to", "flagged"] as const;

export type ResponseFilterField = (typeof RESPONSE_FILTER_FIELDS)[number];

/** Use absence, not an empty string, because the query builder treats absent filters differently from invalid instant text. */
export interface ResponseFilterRequest {
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
  readonly flagged?: "true" | "false";
}

export interface ResponseQuery {
  readonly applied: AppliedFilters;

  readonly request: ResponseFilterRequest;

  readonly hasFilters: boolean;

  readonly ignored: readonly ResponseFilterField[];

  readonly page: number;
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** Malformed nonempty values are reported as ignored, never applied or silently discarded. */
export function parseResponseQuery(query: SearchParams): ResponseQuery {
  const raw = {
    version: one(query["version"]),
    from: one(query["from"]),
    to: one(query["to"]),
    flagged: one(query["flagged"]),
  } as const;
  const rawZone = one(query["tz"]);
  const tz = isTimeZone(rawZone) ? rawZone : "";

  const parsed = {
    version: versionFilter(raw.version),
    from: dayFilter(raw.from),
    to: dayFilter(raw.to),
    flagged: flaggedFilter(raw.flagged),
  } as const;

  const applied: AppliedFilters = {
    version: parsed.version ?? "",
    from: parsed.from ?? "",
    to: parsed.to ?? "",
    flagged: parsed.flagged ?? "",
    ...(tz === "" ? {} : { tz }),
  };

  return {
    applied,
    request: {
      ...(parsed.version === undefined ? {} : { version: parsed.version }),
      ...(parsed.from === undefined ? {} : { from: dayStart(parsed.from, tz || "UTC") }),
      ...(parsed.to === undefined ? {} : { to: dayEnd(parsed.to, tz || "UTC") }),
      ...(parsed.flagged === undefined ? {} : { flagged: parsed.flagged }),
    },

    hasFilters: RESPONSE_FILTER_FIELDS.some((field) => applied[field] !== ""),
    ignored: RESPONSE_FILTER_FIELDS.filter(
      (field) => raw[field] !== "" && parsed[field] === undefined,
    ),
    page: pageNumber(one(query["page"])),
  };
}

/** Normalize numeric spelling so the toolbar agrees with the applied filter. An unpublished positive version can legitimately match nothing and must remain a filter. */
export function versionFilter(value: string): string | undefined {
  if (!/^\d{1,9}$/.test(value)) return undefined;
  const version = Number(value);
  return version >= 1 ? String(version) : undefined;
}

/** Round-trip dates because Date normalizes nonexistent calendar days rather than rejecting them. */
export function dayFilter(value: string): string | undefined {
  /** Preserve years below 100 without the Date.UTC 1900 offset; year zero is unsupported. */
  if (!DAY_ONLY.test(value) || value.startsWith("0000")) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().startsWith(value) ? value : undefined;
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Widen days using the address zone, never the runtime zone, so shared links select identical rows. Time-bearing values pass through for export boundary validation. */
export function dayStart(value: string, timeZone = "UTC"): string {
  return DAY_ONLY.test(value) ? startOfDayIn(value, timeZone) : value;
}

export function dayEnd(value: string, timeZone = "UTC"): string {
  return DAY_ONLY.test(value) ? endOfDayIn(value, timeZone) : value;
}

function flaggedFilter(value: string): "true" | "false" | undefined {
  return value === "true" || value === "false" ? value : undefined;
}

/** Page is a result position, not a filter; unreadable values fall back to one. */
function pageNumber(value: string): number {
  return Math.max(1, Number.parseInt(value === "" ? "1" : value, 10) || 1);
}

/** For repeated parameters use the first value; joining would invent an invalid filter. */
function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
