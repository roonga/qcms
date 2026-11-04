import { QUESTION_TYPES, type QuestionStatus, type QuestionType } from "./types.ts";

// The page and parallel rail resolve one address through this reader; the API owns filtering.

export type SearchParam = string | string[] | undefined;

export interface QuestionListFilters {
  readonly status: QuestionStatus | undefined;

  readonly type: QuestionType | undefined;

  readonly search: string;

  readonly isFiltered: boolean;

  readonly activeCount: number;
}

function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseStatus(raw: SearchParam): QuestionStatus | undefined {
  const value = firstValue(raw);
  return value === "draft" || value === "published" || value === "deprecated" ? value : undefined;
}

// Unknown types fall back to any so stale bookmarks still open the library.
function parseType(raw: SearchParam): QuestionType | undefined {
  const value = firstValue(raw);
  return QUESTION_TYPES.find((type) => type === value);
}

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
