import type { MessageKey } from "../i18n/en.ts";

export interface WorkspaceRailPanel {
  readonly anchor: string;

  readonly labelKey: MessageKey;

  readonly source: string;
}

/** Test fragment IDs against rendered heading sources because broken fragment links otherwise fail silently. */
export const WORKSPACE_RAIL_PANELS: readonly WorkspaceRailPanel[] = [
  {
    anchor: "qcms-members-heading",
    labelKey: "membership.members.heading",
    source: "components/membership/members-panel.tsx",
  },
  {
    anchor: "qcms-access-groups-heading",
    labelKey: "membership.groups.heading",
    source: "components/membership/access-groups-panel.tsx",
  },
  {
    anchor: "qcms-workspace-settings-heading",
    labelKey: "membership.settings.heading",
    source: "components/membership/workspace-settings-panel.tsx",
  },
  {
    anchor: "qcms-audit-heading",
    labelKey: "membership.audit.heading",
    source: "components/membership/audit-panel.tsx",
  },
  {
    anchor: "qcms-agent-audit-heading",
    labelKey: "membership.agentAudit.heading",
    source: "components/membership/agent-audit-panel.tsx",
  },
];
