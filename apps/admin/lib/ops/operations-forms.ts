/**
 * The Operations forms table: what a row carries, and the URL that asks for it.
 *
 * The screen's whole state is the address, so the page and its `@rail` slot read one
 * definition and every control is a link or a native GET form rather than a handler.
 */

import { OPERATIONS_PATH } from "../shell/modes.ts";

/** One raw search-param value, as Next hands it over. */
export type SearchParam = string | string[] | undefined;

/** The three intake readings a form can have in one environment. */
export const OPERATIONS_INTAKES = ["open", "closed", "unreleased"] as const;
export type OperationsIntake = (typeof OPERATIONS_INTAKES)[number];

/** The orders the API guarantees, each total on `(slug, formId)`. */
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

/** What is serving in this environment. Null without `form: read` on the form. */
export interface OperationsRelease {
  readonly version: number;
  readonly releasedAt: string;
  readonly closed: boolean;
}

/** Null unless the caller holds `response: read` for this form and environment. */
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
  /** How many rows matched the filters, before the page was cut. */
  readonly total: number;
  readonly nextCursor: string | null;
  /** The workspaces that contributed a row to this caller's unfiltered set. */
  readonly workspaces: readonly OperationsWorkspace[];
}

/** What the URL says the table should list. */
export interface OperationsListState {
  /**
   * The environment the address names, or `undefined` when it names none and the
   * remembered preference resolves it.
   */
  readonly environment: string | undefined;
  readonly search: string;
  readonly workspaceId: string | undefined;
  readonly intake: OperationsIntake | undefined;
  readonly sort: OperationsSort;
  readonly cursor: string | undefined;
  /**
   * Whether the URL hides a row. The sort and the cursor do not, so neither counts: a
   * table that comes back empty under a non-default order is empty full stop.
   */
  readonly isFiltered: boolean;
  /** How many filters are set, for the rail's active count. */
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

/** An unrecognised order is the default, so a hand-edited address still opens the table. */
function parseSort(raw: SearchParam): OperationsSort {
  const value = firstValue(raw);
  return OPERATIONS_SORTS.find((sort) => sort === value) ?? DEFAULT_OPERATIONS_SORT;
}

export function readOperationsListState(
  params: Readonly<Record<string, SearchParam>>,
): OperationsListState {
  const search = firstValue(params["q"]) ?? "";
  const workspaceId = presentValue(params["workspace"]);
  const intake = parseIntake(params["intake"]);
  const activeCount =
    (search.trim() === "" ? 0 : 1) + (workspaceId === undefined ? 0 : 1) + (intake === undefined ? 0 : 1);
  return {
    environment: presentValue(params["env"]),
    search,
    workspaceId,
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

/**
 * The address this state is, with an optional cursor in place of its own. The order of
 * the parameters is fixed so one view is one address whatever the controls were touched in.
 */
export function operationsHref(
  state: OperationsListState,
  overrides: { readonly cursor?: string | undefined } = {},
): string {
  const cursor = "cursor" in overrides ? overrides.cursor : state.cursor;
  return href([
    ["env", state.environment],
    ["q", state.search.trim() === "" ? undefined : state.search],
    ["workspace", state.workspaceId],
    ["intake", state.intake],
    ["sort", state.sort === DEFAULT_OPERATIONS_SORT ? undefined : state.sort],
    ["cursor", cursor],
  ]);
}

/**
 * Where choosing an environment goes: an Operations-wide change that resets pagination
 * and keeps the filters that are still valid. The workspace options are one environment's
 * answer, so that filter is not among them.
 */
export function operationsEnvironmentHref(
  state: OperationsListState,
  environment: string,
): string {
  return operationsHref({ ...state, environment, workspaceId: undefined, cursor: undefined });
}

/** The unfiltered table in the same environment, for the rail's clear link. */
export function operationsClearHref(state: OperationsListState): string {
  return href([["env", state.environment]]);
}

/** The query `GET /admin/operations/forms` takes for this state in this environment. */
export function operationsApiQuery(state: OperationsListState, environment: string): string {
  const query = new URLSearchParams({ environment });
  const term = state.search.trim();
  if (term !== "") query.set("q", term);
  if (state.workspaceId !== undefined) query.set("workspaceId", state.workspaceId);
  if (state.intake !== undefined) query.set("intake", state.intake);
  query.set("sort", state.sort);
  if (state.cursor !== undefined) query.set("cursor", state.cursor);
  return query.toString();
}

/** A row's intake reading, which separates unreleased from closed. */
export function intakeOf(row: OperationsFormRow): OperationsIntake | undefined {
  if (!row.hasRelease) return "unreleased";
  if (row.release === null) return undefined;
  return row.release.closed ? "closed" : "open";
}
