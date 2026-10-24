import { QUESTION_TYPES, type QuestionStatus, type QuestionType } from "./types.ts";

/**
 * The question library list's URL state (task 032's filters, lifted out of the page by
 * issue #1117).
 *
 * ## Why this is a module now
 *
 * It was four helpers inside `app/(shell)/questions/page.tsx`, which was the right place
 * while one tree read them. §7.0 ruling 4 moves the filters into the rail, and the rail is a
 * parallel-route slot: two React trees are now rendered from one URL and both have to agree
 * about what the URL says. The page asks for the list the filters describe; the rail renders
 * the controls showing them and the count beside them. A second reading of the same
 * parameters is how those two start disagreeing - a status select showing "Any status" over
 * a list the server narrowed, which is a screen saying two things.
 *
 * So both trees ask one pure function about the same address, which is the mechanism
 * `lib/questions/panels.ts` and `lib/forms/list-filters.ts` already use one and two layers
 * up, and `docs/COMPONENT_GUIDELINES.md`'s "lift the decision into a pure module".
 *
 * Nothing here narrows anything. Every value read here is handed to `GET /admin/questions`,
 * which owns the filtering (R2); this module only decides what the screen may ask for.
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
  /**
   * How many of the three filters are set, for the rail's active count and its collapsed
   * summary (§7.0 ruling 2.4 and the 2026-10-24 clarification).
   *
   * All three can hide a question, so unlike the form library there is nothing to exclude:
   * this list has no sort.
   */
  readonly activeCount: number;
}

/** The first value of a repeated param, or `undefined`. */
function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** The status filter's four states. `undefined` means "any". */
function parseStatus(raw: SearchParam): QuestionStatus | undefined {
  const value = firstValue(raw);
  return value === "draft" || value === "published" || value === "deprecated" ? value : undefined;
}

/**
 * The type filter's eight states. `undefined` means "any".
 *
 * An unrecognised type is "any" rather than a refusal, for the reason the form library's
 * sort gives: a stale bookmark or a hand-edited URL should still open the library, and the
 * control then shows what is actually in force.
 */
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
