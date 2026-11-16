import { formatList } from "../i18n/format.ts";
import { t } from "../i18n/en.ts";
import { pageCount } from "../ops/paging.ts";
import { ENVIRONMENT_ROLES, GROUP_ROLES, roleName, type GroupRole } from "./access-group-form.ts";

/** The access acts a shared pattern can offer a control for; the screen passes the ones the caller holds. */
export const ACCESS_CAPABILITIES = [
  "access.read",
  "access.manage",
  "administrators.manage",
  "siteAdministrators.manage",
] as const;

export type AccessCapability = (typeof ACCESS_CAPABILITIES)[number];

export type AccessCapabilities = ReadonlySet<AccessCapability>;

export const NO_ACCESS_CAPABILITIES: AccessCapabilities = new Set();

export interface GroupGrant {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
}

export function isEnvironmentRole(role: string): boolean {
  return ENVIRONMENT_ROLES.includes(role);
}

/** Every role that reads forms also covers View forms (section 3, Role by act). */
const COVERED_BY: Readonly<Record<GroupRole, readonly string[]>> = {
  "forms.viewer": ["forms.viewer", "forms.editor", "forms.publisher"],
  "forms.editor": ["forms.editor"],
  "forms.publisher": ["forms.publisher"],
  "responses.viewer": ["responses.viewer"],
  "responses.eraser": ["responses.eraser"],
};

export interface ExplanationCell {
  /** The environment columns this cell spans: every one for a role that ignores the environment set. */
  readonly environments: readonly string[];
  readonly groups: readonly GroupGrant[];
}

export interface ExplanationRow {
  readonly role: GroupRole;
  readonly cells: readonly ExplanationCell[];
}

function grants(group: GroupGrant, role: GroupRole, environment: string | null): boolean {
  if (!group.roles.some((held) => COVERED_BY[role].includes(held))) return false;
  if (environment === null) return true;
  return group.environments.includes(environment);
}

/** Each role by environment, naming the groups that grant it; an empty cell is "no group grants this". */
export function explainAccess(
  groups: readonly GroupGrant[],
  environments: readonly string[],
): readonly ExplanationRow[] {
  return GROUP_ROLES.map((role) => ({
    role,
    cells: isEnvironmentRole(role)
      ? environments.map((environment) => ({
          environments: [environment],
          groups: groups.filter((group) => grants(group, role, environment)),
        }))
      : [{ environments, groups: groups.filter((group) => grants(group, role, null)) }],
  }));
}

export interface AccessChange {
  readonly role: GroupRole;
  /** Empty for a role that ignores the environment set. */
  readonly environments: readonly string[];
}

export interface AccessKept extends AccessChange {
  readonly groups: readonly string[];
}

export interface AccessDelta {
  readonly gains: readonly AccessChange[];
  readonly losses: readonly AccessChange[];
  readonly keeps: readonly AccessKept[];
}

function sameGrant(a: GroupGrant, b: GroupGrant): boolean {
  const same = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && x.every((entry) => y.includes(entry));
  return same(a.roles, b.roles) && same(a.environments, b.environments);
}

class Collected {
  private readonly entries = new Map<GroupRole, { environments: string[]; groups: string[] }>();

  add(role: GroupRole, environment: string | null, groups: readonly string[] = []): void {
    const entry = this.entries.get(role) ?? { environments: [], groups: [] };
    if (environment !== null) entry.environments.push(environment);
    for (const group of groups) if (!entry.groups.includes(group)) entry.groups.push(group);
    this.entries.set(role, entry);
  }

  changes(): readonly AccessChange[] {
    return [...this.entries].map(([role, entry]) => ({ role, environments: entry.environments }));
  }

  kept(): readonly AccessKept[] {
    return [...this.entries].map(([role, entry]) => ({ role, ...entry }));
  }
}

/** What one person gains, loses and keeps when their groups go from `before` to `after`. */
export function accessDelta(
  before: readonly GroupGrant[],
  after: readonly GroupGrant[],
  environments: readonly string[],
): AccessDelta {
  const touched = new Set(
    before
      .filter((group) => {
        const next = after.find((candidate) => candidate.id === group.id);
        return next === undefined || !sameGrant(group, next);
      })
      .map((group) => group.id),
  );
  const now = explainAccess(after, environments);
  const gains = new Collected();
  const losses = new Collected();
  const keeps = new Collected();
  explainAccess(before, environments).forEach((row, rowIndex) => {
    row.cells.forEach((cell, cellIndex) => {
      const nowGroups = now[rowIndex]?.cells[cellIndex]?.groups ?? [];
      const environment = isEnvironmentRole(row.role) ? (cell.environments[0] ?? null) : null;
      const held = cell.groups.length > 0;
      if (!held && nowGroups.length > 0) gains.add(row.role, environment);
      if (held && nowGroups.length === 0) losses.add(row.role, environment);
      if (held && nowGroups.length > 0 && cell.groups.some((group) => touched.has(group.id))) {
        keeps.add(
          row.role,
          environment,
          nowGroups.map((group) => group.name),
        );
      }
    });
  });
  return { gains: gains.changes(), losses: losses.changes(), keeps: keeps.kept() };
}

/** One change in plain words: the role, then the environments it applies in. */
export function describeChange(change: AccessChange, locale: string): string {
  const role = roleName(change.role);
  return change.environments.length === 0
    ? role
    : t("access.change.in", { role, environments: formatList(change.environments, locale) });
}

export function describeKept(kept: AccessKept, locale: string): string {
  return t("access.change.through", {
    change: describeChange(kept, locale),
    groups: formatList(kept.groups, locale),
  });
}

export interface UncoveredScope {
  readonly roles: readonly GroupRole[];
  readonly environments: readonly string[];
}

/** Roles no group grants anywhere, and environments no group names. */
export function uncoveredScope(
  groups: readonly GroupGrant[],
  environments: readonly string[],
): UncoveredScope {
  return {
    roles: explainAccess(groups, environments)
      .filter((row) => row.cells.every((cell) => cell.groups.length === 0))
      .map((row) => row.role),
    environments: environments.filter(
      (environment) => !groups.some((group) => group.environments.includes(environment)),
    ),
  };
}

/** What deleting or changing a group leaves uncovered that was covered before. */
export function newlyUncovered(
  before: readonly GroupGrant[],
  after: readonly GroupGrant[],
  environments: readonly string[],
): UncoveredScope {
  const was = uncoveredScope(before, environments);
  const now = uncoveredScope(after, environments);
  return {
    roles: now.roles.filter((role) => !was.roles.includes(role)),
    environments: now.environments.filter((environment) => !was.environments.includes(environment)),
  };
}

export const ACCESS_STATUSES = ["active", "unclaimed", "suspended", "disabled"] as const;

export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const ACCESS_SEARCH_MAX_LENGTH = 200;

export interface AccessFilters {
  readonly search: string;
  readonly role: string | undefined;
  readonly environment: string | undefined;
  readonly status: AccessStatus | undefined;
  readonly activeCount: number;
}

export interface AccessFilterOptions {
  readonly roles: readonly string[];
  readonly environments: readonly string[];
  readonly statuses: readonly AccessStatus[];
}

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

function pick<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return allowed.find((entry) => entry === value);
}

/** The filters a query string asks for; a value the screen does not offer is dropped, not obeyed. */
export function readAccessFilters(
  params: SearchParams,
  options: AccessFilterOptions,
): AccessFilters {
  const search = first(params.q).trim().slice(0, ACCESS_SEARCH_MAX_LENGTH);
  const role = pick(first(params.role), options.roles);
  const environment = pick(first(params.environment), options.environments);
  const status = pick(first(params.status), options.statuses);
  const activeCount = [search !== "", role, environment, status].filter(
    (entry) => entry !== undefined && entry !== false,
  ).length;
  return { search, role, environment, status, activeCount };
}

export interface FilterableEntry {
  readonly name: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
  readonly status: AccessStatus;
}

export function matchesAccessFilters(entry: FilterableEntry, filters: AccessFilters): boolean {
  const needle = filters.search.toLocaleLowerCase();
  if (
    needle !== "" &&
    !entry.name.toLocaleLowerCase().includes(needle) &&
    !entry.email.toLocaleLowerCase().includes(needle)
  ) {
    return false;
  }
  if (filters.role !== undefined && !entry.roles.includes(filters.role)) return false;
  if (filters.environment !== undefined && !entry.environments.includes(filters.environment)) {
    return false;
  }
  return filters.status === undefined || entry.status === filters.status;
}

export interface ResultRange {
  readonly first: number;
  readonly last: number;
  readonly total: number;
  readonly previous: number | undefined;
  readonly next: number | undefined;
}

/** The rows a one-based page shows, and the neighbouring pages that exist. */
export function resultRange(page: number, pageSize: number, total: number): ResultRange {
  const pages = pageCount(total, pageSize);
  const current = Math.min(Math.max(1, Math.trunc(page)), pages);
  const size = Math.max(1, pageSize);
  const count = Math.max(0, total);
  return {
    first: count === 0 ? 0 : (current - 1) * size + 1,
    last: Math.min(current * size, count),
    total: count,
    previous: current > 1 ? current - 1 : undefined,
    next: current < pages ? current + 1 : undefined,
  };
}
