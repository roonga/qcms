import type { MessageKey } from "../i18n/en.ts";

/** One row of the workspace detail rail. */
export interface WorkspaceRailPanel {
  /** The heading id the row's fragment names, as the panel renders it. */
  readonly anchor: string;
  /** The row's label, which is the panel's own heading. */
  readonly labelKey: MessageKey;
  /** The panel component the id lives in, repo-relative, for the gate beside this file. */
  readonly source: string;
}

/**
 * The workspace detail rail's four Sections, in the page's own order.
 *
 * Each anchor has to equal a heading id in another file, and a fragment that matches nothing
 * fails silently, so `rail-panels.test.ts` checks every pair against the panels' sources.
 */
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
];
