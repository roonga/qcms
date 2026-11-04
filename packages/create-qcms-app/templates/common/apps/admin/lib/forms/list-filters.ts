import { DEFAULT_FORM_SORT, FORM_SORTS, type FormSort, type FormStatus } from "./types.ts";

// URL filters are request parameters only; the API owns narrowing and ordering, including results beyond one response.

export type SearchParam = string | string[] | undefined;

export interface FormListFilters {
  readonly status: FormStatus | undefined;

  readonly sort: FormSort;

  readonly search: string;
  // Sort does not filter rows; clearing sort cannot recover an empty library.
  readonly isFiltered: boolean;

  readonly activeCount: number;
}

function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseStatus(raw: SearchParam): FormStatus | undefined {
  const value = firstValue(raw);
  return value === "open" || value === "closed" ? value : undefined;
}

function parseSort(raw: SearchParam): FormSort {
  const value = firstValue(raw);
  return FORM_SORTS.find((sort) => sort === value) ?? DEFAULT_FORM_SORT;
}

export function readFormListFilters(
  params: Readonly<Record<string, SearchParam>>,
): FormListFilters {
  const status = parseStatus(params["status"]);
  const search = firstValue(params["q"]) ?? "";
  const activeCount = (status === undefined ? 0 : 1) + (search.trim() === "" ? 0 : 1);
  return {
    status,
    sort: parseSort(params["sort"]),
    search,
    isFiltered: activeCount > 0,
    activeCount,
  };
}
