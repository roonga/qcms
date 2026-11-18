import type { AccessCapabilities } from "./access-patterns.ts";
import { workspaceSectionHref } from "./sections.ts";

/** Members and Access groups are served only to a Workspace or Site administrator, who holds all three. */
export const WORKSPACE_ADMINISTRATION: AccessCapabilities = new Set([
  "access.read",
  "access.manage",
  "administrators.manage",
] as const);

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export function membersGrantHref(workspaceId: string): string {
  return `${workspaceSectionHref(workspaceId, "members")}?grant=1`;
}

export function newGroupHref(workspaceId: string): string {
  return `${workspaceSectionHref(workspaceId, "access-groups")}?new=1`;
}

/** The level-2 rail rows: Grant under Members and New under Access groups. */
export type WorkspaceSubView = "grant" | "new";

export interface GrantView {
  readonly email: string;
  readonly group: string | undefined;
}

/** Members' Grant view, pre-filled from the query; a group this workspace lacks is dropped. */
export function readGrantView(
  params: SearchParams,
  groupIds: readonly string[],
): GrantView | undefined {
  if (first(params.grant) === undefined) return undefined;
  const group = first(params.group);
  return {
    email: (first(params.email) ?? "").trim().slice(0, 320),
    group: groupIds.find((id) => id === group),
  };
}

export interface GroupsView {
  readonly creating: boolean;
  readonly group: string | undefined;
}

export function readGroupsView(params: SearchParams, groupIds: readonly string[]): GroupsView {
  const group = first(params.group);
  return {
    creating: first(params.new) !== undefined,
    group: groupIds.find((id) => id === group),
  };
}

export function subViewOf(params: SearchParams): WorkspaceSubView | undefined {
  if (first(params.grant) !== undefined) return "grant";
  if (first(params.new) !== undefined) return "new";
  return undefined;
}
