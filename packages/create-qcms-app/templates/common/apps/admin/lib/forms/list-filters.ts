import { DEFAULT_FORM_SORT, FORM_SORTS, type FormSort, type FormStatus } from "./types.ts";

/**
 * The form library list's URL state (issue 686).
 *
 * The list's search term, status filter and sort key live in the query string, so a
 * filtered library is a place an author can link to and come back to. Reading them is a
 * decision - which raw value counts, what "any" means, whether the screen is filtered -
 * so it is a pure module with its own tests rather than four helpers inside the page
 * (`docs/COMPONENT_GUIDELINES.md`, "lift the decision into a pure module").
 *
 * Nothing here narrows or orders anything. Every value read here is handed to the API,
 * which owns both (R2); this module only decides what the screen is allowed to ask for.
 */

/** One raw search-param value, as Next hands it over. */
export type SearchParam = string | string[] | undefined;

/** What the URL says the list should show. */
export interface FormListFilters {
  /** The lifecycle filter, or `undefined` for "any status". */
  readonly status: FormStatus | undefined;
  /** The order to ask the API for. Always resolved: the URL's, or the default. */
  readonly sort: FormSort;
  /** The raw search term, trimmed of nothing - the API trims what it matches on. */
  readonly search: string;
  /**
   * Whether the URL narrows the library.
   *
   * **Sorting is not filtering**, and the difference decides which of two empty states
   * the screen shows. A sort never removes a row, so a library that comes back empty
   * under a non-default sort is empty full stop, and offering "Clear filters" there
   * would point at a control that changes nothing. Only the search term and the status
   * filter can hide a form, so only they count here.
   */
  readonly isFiltered: boolean;
}

/** The first value of a repeated param, or `undefined`. */
function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** The status filter's three states. `undefined` means "any". */
function parseStatus(raw: SearchParam): FormStatus | undefined {
  const value = firstValue(raw);
  return value === "open" || value === "closed" ? value : undefined;
}

/**
 * The sort key, falling back to the default.
 *
 * An unrecognised key is the default rather than a refusal: a stale bookmark or a
 * hand-edited URL should still open the library, and the Sort control then shows the
 * order actually in force instead of an option that does not exist.
 */
function parseSort(raw: SearchParam): FormSort {
  const value = firstValue(raw);
  return FORM_SORTS.find((sort) => sort === value) ?? DEFAULT_FORM_SORT;
}

/** Read the list's URL state out of Next's resolved `searchParams`. */
export function readFormListFilters(
  params: Readonly<Record<string, SearchParam>>,
): FormListFilters {
  const status = parseStatus(params["status"]);
  const search = firstValue(params["q"]) ?? "";
  return {
    status,
    sort: parseSort(params["sort"]),
    search,
    isFiltered: status !== undefined || search.trim() !== "",
  };
}
