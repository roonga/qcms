import type { AppliedFilters } from "./browse.ts";

/**
 * Reading the response browser's filters out of the querystring, once (issue 521).
 *
 * ## One parse, two consumers
 *
 * The page has to answer two questions about the same querystring: *what do I ask the
 * API for*, and *which empty message is true*. It used to answer them from two
 * different expressions, and they disagreed. `?flagged=maybe` was dropped from the
 * request (the API takes `true`/`false` and nothing else) but still counted as a
 * filter, so a form with no submissions rendered "No response matches these filters"
 * about a filter that was never applied - the screen making a false statement about
 * its own behaviour. In the other direction `?from=nonsense` was concatenated into
 * `nonsenseT00:00:00.000Z` and sent, and the same unvalidated string was handed to the
 * toolbar's day picker, whose vendored body is `value ? parseDate(value) : undefined`.
 * `parseDate` throws on it, so a typo in the address bar did not cost one filter or even
 * the list: the whole screen was a 500. Validating here fixes both, because the picker
 * can now only receive a day or nothing.
 *
 * This module is the single answer both consumers read: a value that does not parse is
 * not a filter, so it reaches neither the request nor `hasFilters`, and it is named in
 * `ignored` so the page can say it was dropped instead of pretending it was applied.
 *
 * ## Why the rejected values are reported rather than swallowed
 *
 * The sibling library list (032) validates the same way and says nothing, and for its
 * filters that is fine: they are a status, a type and a search box, and an unparseable
 * one is only reachable by hand-editing the address. This screen is different in one
 * concrete way. Its dates are a *range*, and the number beside the table is a count an
 * operator acts on. Silently dropping `?from=03/01/2026` would show the whole form's
 * total to someone who believes they are reading March, which is the same class of
 * false statement this issue is fixing, just quieter. Naming what was dropped keeps
 * the screen's account of itself complete, and it costs one sentence.
 *
 * ## Dates are widened here, not at the call site
 *
 * `from` and `to` are whole UTC days in the toolbar and instants in the API, so the
 * widening (`T00:00:00.000Z` / `T23:59:59.999Z`) lives next to the validation that
 * earns it. Building the instant anywhere else is what let an unvalidated value become
 * a malformed one.
 */

/** The four filter parameters, in the order the toolbar shows them. */
export const RESPONSE_FILTER_FIELDS = ["version", "from", "to", "flagged"] as const;

/** One filter parameter's name, which is also its i18n label suffix. */
export type ResponseFilterField = (typeof RESPONSE_FILTER_FIELDS)[number];

/**
 * The filters as `listResponses` takes them: absent, or a value the API accepts.
 *
 * Optional rather than empty-string-bearing, because "absent" is what the query
 * builder tests for and an empty string here would be a second way to say it.
 */
export interface ResponseFilterRequest {
  readonly version?: string;
  readonly from?: string;
  readonly to?: string;
  readonly flagged?: "true" | "false";
}

/** Everything the page derives from the querystring, from one parse. */
export interface ResponseQuery {
  /** What was applied: the toolbar's values and what a page link carries. */
  readonly applied: AppliedFilters;
  /** The same set, shaped for the API call. */
  readonly request: ResponseFilterRequest;
  /** Whether any filter was applied, which decides which empty message is true. */
  readonly hasFilters: boolean;
  /** Parameters that carried a value no filter accepts, in toolbar order. */
  readonly ignored: readonly ResponseFilterField[];
  /** The requested page, at least 1. */
  readonly page: number;
}

/** Search params as Next hands them over. */
type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/**
 * Parse the browser's querystring into the one filter set the page uses everywhere.
 *
 * The rule for every parameter is the same: an absent or empty value is no filter and
 * no complaint, a value the API would accept is a filter, and anything else is neither
 * a filter nor silence.
 */
export function parseResponseQuery(query: SearchParams): ResponseQuery {
  const raw = {
    version: one(query["version"]),
    from: one(query["from"]),
    to: one(query["to"]),
    flagged: one(query["flagged"]),
  } as const;

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
  };

  return {
    applied,
    request: {
      ...(parsed.version === undefined ? {} : { version: parsed.version }),
      ...(parsed.from === undefined ? {} : { from: `${parsed.from}T00:00:00.000Z` }),
      ...(parsed.to === undefined ? {} : { to: `${parsed.to}T23:59:59.999Z` }),
      ...(parsed.flagged === undefined ? {} : { flagged: parsed.flagged }),
    },
    // Read off `applied`, which holds only values that parsed. This is the whole fix:
    // the empty-state discriminator and the request now come from the same result.
    hasFilters: RESPONSE_FILTER_FIELDS.some((field) => applied[field] !== ""),
    ignored: RESPONSE_FILTER_FIELDS.filter(
      (field) => raw[field] !== "" && parsed[field] === undefined,
    ),
    page: pageNumber(one(query["page"])),
  };
}

/**
 * A version filter: a positive integer, as the API's `parseVersion` defines it.
 *
 * Membership in the form's published versions is deliberately NOT checked. A version
 * that exists but collected nothing, and a version number that was never published,
 * are both filters that legitimately match nothing, and answering them with the
 * filtered empty state is the true answer. Only a value that is not a version number
 * at all is dropped.
 */
function versionFilter(value: string): string | undefined {
  if (!/^\d{1,9}$/.test(value)) return undefined;
  return Number(value) >= 1 ? value : undefined;
}

/**
 * A whole-UTC-day filter, in the `YYYY-MM-DD` shape the day pickers emit.
 *
 * The round trip is not redundant with the pattern: `2026-02-31` matches the pattern
 * and `Date` rolls it forward to March 3rd rather than rejecting it, so a day that
 * does not exist would otherwise become a filter for a different day.
 */
function dayFilter(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().startsWith(value) ? value : undefined;
}

/** The flag filter: the API's enum, and nothing that merely looks like it. */
function flaggedFilter(value: string): "true" | "false" | undefined {
  return value === "true" || value === "false" ? value : undefined;
}

/**
 * The requested page.
 *
 * Not a filter: it never reaches `hasFilters` and is not reported as ignored, because
 * a page number is a position in a result set rather than a claim about which rows are
 * in it. An unreadable one falls back to the first page.
 */
function pageNumber(value: string): number {
  return Math.max(1, Number.parseInt(value === "" ? "1" : value, 10) || 1);
}

/**
 * Read one value out of a search param.
 *
 * Next hands a repeated parameter back as an array. Taking the first rather than
 * joining is what a duplicated `?version=1&version=2` should mean here: one of them
 * is the filter, and concatenating them would build a value the API can only reject.
 */
function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
