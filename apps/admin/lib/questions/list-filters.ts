import { QUESTION_TYPES, type QuestionStatus, type QuestionType } from "./types.ts";

/**
 * The question library's URL state, read in one place because the page and the `@rail` slot
 * are two React trees rendered from one address and must agree about it.
 *
 * Nothing here narrows anything: every value goes to `GET /admin/questions` (R2).
 */

/** One raw search-param value, as Next hands it over. */
export type SearchParam = string | string[] | undefined;

/** What the URL says the library should show. */
export interface QuestionListFilters {
  /** The status filter, or `undefined` for "any status". */
  readonly status: QuestionStatus | undefined;
  /** The type filter, or `undefined` for "any type". */
  readonly type: QuestionType | undefined;
  /** The raw search term. The API trims what it matches on. */
  readonly search: string;
  /** Whether the URL narrows the library, which decides which empty state the page shows. */
  readonly isFiltered: boolean;
  /** How many of the three filters are set, for the rail's active count. */
  readonly activeCount: number;
}

function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseStatus(raw: SearchParam): QuestionStatus | undefined {
  const value = firstValue(raw);
  return value === "draft" || value === "published" || value === "deprecated" ? value : undefined;
}

/** An unrecognised type reads as "any", so a stale bookmark still opens the library. */
function parseType(raw: SearchParam): QuestionType | undefined {
  const value = firstValue(raw);
  return QUESTION_TYPES.find((type) => type === value);
}

/** Read the library's URL state out of Next's resolved `searchParams`. */
export function readQuestionListFilters(
  params: Readonly<Record<string, SearchParam>>,
): QuestionListFilters {
  const status = parseStatus(params["status"]);
  const type = parseType(params["type"]);
  const search = firstValue(params["q"]) ?? "";
  const activeCount =
    (status === undefined ? 0 : 1) + (type === undefined ? 0 : 1) + (search.trim() === "" ? 0 : 1);
  return { status, type, search, isFiltered: activeCount > 0, activeCount };
}
