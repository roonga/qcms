import type { MessageKey } from "../i18n/en.ts";

export const WORKSPACES_ROOT = "/workspaces";

/** The full list. Its own address because the area's root lands on the current workspace. */
export const ALL_WORKSPACES_PATH = `${WORKSPACES_ROOT}/all`;

export const ALL_WORKSPACES_SEGMENT = "all";

/** Each section of one workspace is its own screen, in the rail's order; the first is where the workspace's own address lands. */
export const WORKSPACE_SECTIONS = [
  "members",
  "access-groups",
  "settings",
  "audit",
  "assistant-actions",
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const FIRST_WORKSPACE_SECTION: WorkspaceSection = "members";

export const WORKSPACE_SECTION_LABELS: Readonly<Record<WorkspaceSection, MessageKey>> = {
  members: "membership.members.heading",
  "access-groups": "membership.groups.heading",
  settings: "membership.settings.heading",
  audit: "membership.audit.heading",
  "assistant-actions": "membership.agentAudit.heading",
};

export function workspaceSectionHref(workspaceId: string, section: WorkspaceSection): string {
  return `${WORKSPACES_ROOT}/${encodeURIComponent(workspaceId)}/${section}`;
}

export function workspaceHref(workspaceId: string): string {
  return workspaceSectionHref(workspaceId, FIRST_WORKSPACE_SECTION);
}
