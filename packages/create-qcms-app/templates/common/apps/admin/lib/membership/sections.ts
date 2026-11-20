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
  "archive",
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

/**
 * The sections a site with one workspace has: archiving is refused while the workspace owns a
 * form, and one workspace has nowhere to move its forms to.
 */
export const WORKSPACE_SECTIONS_AT_ONE: readonly WorkspaceSection[] = WORKSPACE_SECTIONS.filter(
  (entry) => entry !== "archive",
);

export const FIRST_WORKSPACE_SECTION: WorkspaceSection = "members";

/** The area's own name: a plural promises a choice an installation with one workspace does not have. */
export function workspaceAreaLabel(multiple: boolean): MessageKey {
  return multiple ? "membership.area.title" : "membership.area.titleOne";
}

export const WORKSPACE_SECTION_LABELS: Readonly<Record<WorkspaceSection, MessageKey>> = {
  members: "membership.members.heading",
  "access-groups": "membership.groups.heading",
  settings: "membership.settings.heading",
  audit: "membership.audit.heading",
  "assistant-actions": "membership.agentAudit.heading",
  archive: "membership.archive.heading",
};

export function workspaceSectionHref(workspaceId: string, section: WorkspaceSection): string {
  return `${WORKSPACES_ROOT}/${encodeURIComponent(workspaceId)}/${section}`;
}

export function workspaceHref(workspaceId: string): string {
  return workspaceSectionHref(workspaceId, FIRST_WORKSPACE_SECTION);
}
