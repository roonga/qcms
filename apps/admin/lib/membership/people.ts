import { ACCESS_SEARCH_MAX_LENGTH, type AccessStatus, type GroupGrant } from "./access-patterns.ts";
import type { AccessGroup, WorkspaceMember } from "./types.ts";

export const WORKSPACE_ADMINISTRATOR_ROLE = "forms.owner";

export const MEMBER_STATUSES: readonly AccessStatus[] = [
  "active",
  "unclaimed",
  "suspended",
  "disabled",
];

export const MEMBERS_PAGE_SIZE = 50;

export interface PersonHold {
  readonly group: AccessGroup;
  readonly suspended: boolean;
}

export interface PersonRow {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly administrator: boolean;
  readonly status: AccessStatus;
  readonly holds: readonly PersonHold[];
}

/** Each member with the groups they are in, read from the groups' own people rather than by name. */
export function peopleRows(
  members: readonly WorkspaceMember[],
  groups: readonly AccessGroup[],
): readonly PersonRow[] {
  return members.map((member) => {
    const holds = groups.flatMap((group) => {
      const holder = group.holders.find((entry) => entry.userId === member.userId);
      return holder === undefined ? [] : [{ group, suspended: holder.suspended }];
    });
    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      administrator: member.role === WORKSPACE_ADMINISTRATOR_ROLE,
      status: personStatus(member.status, holds),
      holds,
    };
  });
}

// The account's own state wins: a disabled or unclaimed account holds nothing either way.
function personStatus(
  status: WorkspaceMember["status"],
  holds: readonly PersonHold[],
): AccessStatus {
  if (status !== "active") return status;
  return holds.some((hold) => hold.suspended) ? "suspended" : "active";
}

export function grantOf(group: AccessGroup): GroupGrant {
  return {
    id: group.teamId,
    name: group.name,
    roles: group.roles,
    environments: group.environments,
  };
}

/** What a person's groups grant them now: a suspended hold grants nothing until re-confirmed. */
export function liveGrants(row: PersonRow): readonly GroupGrant[] {
  return row.holds.filter((hold) => !hold.suspended).map((hold) => grantOf(hold.group));
}

/** Matches the API's guard: only an active, claimed Workspace administrator counts. */
export function isLastAdministrator(rows: readonly PersonRow[], userId: string): boolean {
  const counted = rows.filter(
    (row) => row.administrator && row.status !== "disabled" && row.status !== "unclaimed",
  );
  return counted.length <= 1 && counted.some((row) => row.userId === userId);
}

/** Nobody re-confirms their own suspended membership, so the control is never offered to its subject. */
export function offersReconfirm(viewerId: string, subjectId: string, suspended: boolean): boolean {
  return suspended && viewerId !== subjectId;
}

export interface MemberFilters {
  readonly search: string;
  readonly group: string | undefined;
  readonly administrator: "yes" | "no" | undefined;
  readonly status: AccessStatus | undefined;
  readonly page: number;
  readonly activeCount: number;
}

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string {
  return (typeof value === "string" ? value : value?.[0]) ?? "";
}

/** The filters a query string asks for; a value the screen does not offer is dropped, not obeyed. */
export function readMemberFilters(
  params: SearchParams,
  groupIds: readonly string[],
): MemberFilters {
  const search = first(params.q).trim().slice(0, ACCESS_SEARCH_MAX_LENGTH);
  const group = groupIds.find((id) => id === first(params.group));
  const wanted = first(params.administrator);
  const administrator = wanted === "yes" || wanted === "no" ? wanted : undefined;
  const status = MEMBER_STATUSES.find((entry) => entry === first(params.status));
  const parsed = Number.parseInt(first(params.page), 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const activeCount = [search === "" ? undefined : search, group, administrator, status].filter(
    (entry) => entry !== undefined,
  ).length;
  return { search, group, administrator, status, page, activeCount };
}

export function matchesMember(row: PersonRow, filters: MemberFilters): boolean {
  const needle = filters.search.toLocaleLowerCase();
  if (
    needle !== "" &&
    !row.name.toLocaleLowerCase().includes(needle) &&
    !row.email.toLocaleLowerCase().includes(needle)
  ) {
    return false;
  }
  if (
    filters.group !== undefined &&
    !row.holds.some((hold) => hold.group.teamId === filters.group)
  ) {
    return false;
  }
  if (
    filters.administrator !== undefined &&
    row.administrator !== (filters.administrator === "yes")
  ) {
    return false;
  }
  return filters.status === undefined || row.status === filters.status;
}

/** The query string for one page of the same filters. */
export function memberFiltersQuery(filters: MemberFilters, page: number): string {
  const query = new URLSearchParams();
  if (filters.search !== "") query.set("q", filters.search);
  if (filters.group !== undefined) query.set("group", filters.group);
  if (filters.administrator !== undefined) query.set("administrator", filters.administrator);
  if (filters.status !== undefined) query.set("status", filters.status);
  if (page > 1) query.set("page", String(page));
  return query.size === 0 ? "" : `?${query.toString()}`;
}

export function pageOf<T>(rows: readonly T[], page: number, size: number): readonly T[] {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return rows.slice((current - 1) * size, current * size);
}
