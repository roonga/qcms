import type { MessageKey } from "../i18n/en.ts";

export const WORKSPACES_ROOT = "/workspaces";

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

export interface WorkspaceSectionDef {
  readonly labelKey: MessageKey;
  /** The heading id the section's screen renders, so the region it labels is named. */
  readonly headingId: string;
  /** The panel that renders that heading. */
  readonly source: string;
}

export const WORKSPACE_SECTION_DEFS: Readonly<Record<WorkspaceSection, WorkspaceSectionDef>> = {
  members: {
    labelKey: "membership.members.heading",
    headingId: "qcms-members-heading",
    source: "components/membership/members-panel.tsx",
  },
  "access-groups": {
    labelKey: "membership.groups.heading",
    headingId: "qcms-access-groups-heading",
    source: "components/membership/access-groups-panel.tsx",
  },
  settings: {
    labelKey: "membership.settings.heading",
    headingId: "qcms-workspace-settings-heading",
    source: "components/membership/workspace-settings-panel.tsx",
  },
  audit: {
    labelKey: "membership.audit.heading",
    headingId: "qcms-audit-heading",
    source: "components/membership/audit-panel.tsx",
  },
  "assistant-actions": {
    labelKey: "membership.agentAudit.heading",
    headingId: "qcms-agent-audit-heading",
    source: "components/membership/agent-audit-panel.tsx",
  },
};

export function workspaceSectionHref(workspaceId: string, section: WorkspaceSection): string {
  return `${WORKSPACES_ROOT}/${encodeURIComponent(workspaceId)}/${section}`;
}

export function workspaceHref(workspaceId: string): string {
  return workspaceSectionHref(workspaceId, FIRST_WORKSPACE_SECTION);
}
