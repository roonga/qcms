/** Share URL state between page and rail; controls are links or native GET forms. */

import { OPERATIONS_PATH } from "../shell/modes.ts";

export type SearchParam = string | string[] | undefined;

export const OPERATIONS_INTAKES = ["open", "closed", "unreleased"] as const;
export type OperationsIntake = (typeof OPERATIONS_INTAKES)[number];

export const OPERATIONS_SORTS = [
  "slug-asc",
  "slug-desc",
  "released-desc",
  "released-asc",
  "submitted-desc",
  "submitted-asc",
] as const;
export type OperationsSort = (typeof OPERATIONS_SORTS)[number];

export const DEFAULT_OPERATIONS_SORT: OperationsSort = "slug-asc";

export interface OperationsWorkspace {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
}

export interface OperationsRelease {
  readonly version: number;
  readonly releasedAt: string;
  readonly closed: boolean;
}

export interface OperationsCounts {
  readonly submitted: number;
  readonly inProgress: number;
}

export interface OperationsFormRow {
  readonly formId: string;
  readonly slug: string;
  readonly defaultLocale: string;
  readonly displayName: string;
  readonly workspace: OperationsWorkspace;
  readonly hasRelease: boolean;
  readonly release: OperationsRelease | null;
  readonly lastReleaseAt: string | null;
  readonly counts: OperationsCounts | null;
  readonly capabilities: readonly string[];
}

export interface OperationsFormsPage {
  readonly environment: string;
  readonly forms: readonly OperationsFormRow[];

  readonly total: number;
  readonly nextCursor: string | null;

  readonly workspaces: readonly OperationsWorkspace[];
}

export interface OperationsListState {
  readonly environment: string | undefined;
  readonly search: string;
  readonly intake: OperationsIntake | undefined;
  readonly sort: OperationsSort;
  readonly cursor: string | undefined;
  /** Sort and cursor change position, not row membership, so neither implies a filtered empty state. */
  readonly isFiltered: boolean;

  readonly activeCount: number;
}

function firstValue(raw: SearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function presentValue(raw: SearchParam): string | undefined {
  const value = firstValue(raw);
  return value === undefined || value === "" ? undefined : value;
}

function parseIntake(raw: SearchParam): OperationsIntake | undefined {
  const value = firstValue(raw);
  return OPERATIONS_INTAKES.find((intake) => intake === value);
}

function parseSort(raw: SearchParam): OperationsSort {
  const value = firstValue(raw);
  return OPERATIONS_SORTS.find((sort) => sort === value) ?? DEFAULT_OPERATIONS_SORT;
}

export function readOperationsListState(
  params: Readonly<Record<string, SearchParam>>,
): OperationsListState {
  const search = firstValue(params["q"]) ?? "";
  const intake = parseIntake(params["availability"] ?? params["intake"]);
  const activeCount = (search.trim() === "" ? 0 : 1) + (intake === undefined ? 0 : 1);
  return {
    environment: presentValue(params["env"]),
    search,
    intake,
    sort: parseSort(params["sort"]),
    cursor: presentValue(params["cursor"]),
    isFiltered: activeCount > 0,
    activeCount,
  };
}

function href(parts: readonly (readonly [string, string | undefined])[]): string {
  const query = new URLSearchParams();
  for (const [name, value] of parts) {
    if (value !== undefined && value !== "") query.set(name, value);
  }
  const serialized = query.toString();
  return serialized === "" ? OPERATIONS_PATH : `${OPERATIONS_PATH}?${serialized}`;
}

export function operationsHref(
  state: OperationsListState,
  overrides: { readonly cursor?: string | undefined } = {},
): string {
  const cursor = "cursor" in overrides ? overrides.cursor : state.cursor;
  return href([
    ["env", state.environment],
    ["q", state.search.trim() === "" ? undefined : state.search],
    ["availability", state.intake],
    ["sort", state.sort === DEFAULT_OPERATIONS_SORT ? undefined : state.sort],
    ["cursor", cursor],
  ]);
}

/** An environment switch resets the page position: a cursor cut in one environment names no row in another. */
export function operationsInEnvironment(
  state: OperationsListState,
  environment: string,
): OperationsListState {
  if (state.environment === environment) return state;
  return { ...state, environment, cursor: undefined };
}

export function operationsClearHref(state: OperationsListState): string {
  return href([["env", state.environment]]);
}

/** `workspaceId` is the current workspace, not a filter: Operations reads the one the shell is in. */
export function operationsApiQuery(
  state: OperationsListState,
  environment: string,
  workspaceId: string | undefined,
): string {
  const query = new URLSearchParams({ environment });
  const term = state.search.trim();
  if (term !== "") query.set("q", term);
  if (workspaceId !== undefined) query.set("workspaceId", workspaceId);
  // `intake` is the API's own parameter name.
  if (state.intake !== undefined) query.set("intake", state.intake);
  query.set("sort", state.sort);
  if (state.cursor !== undefined) query.set("cursor", state.cursor);
  return query.toString();
}

export function intakeOf(row: OperationsFormRow): OperationsIntake | undefined {
  if (!row.hasRelease) return "unreleased";
  if (row.release === null) return undefined;
  return row.release.closed ? "closed" : "open";
}
