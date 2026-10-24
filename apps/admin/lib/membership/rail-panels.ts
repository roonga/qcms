import type { MessageKey } from "../i18n/en.ts";

/**
 * Which panels the workspace detail rail lists, and the id each row anchors onto
 * (`plan/admin-design-contracts.md` §7.0's table, issue #1117).
 *
 * ## Why this is a module rather than an array inside the component
 *
 * Every entry is half of an equality that spans two files: the row's `href` is a fragment,
 * and the element it has to equal is a heading id written in
 * `components/membership/*-panel.tsx`. A fragment that matches nothing fails silently -
 * the browser does nothing at all - so this is exactly the kind of pair that rots without
 * anybody noticing, and `rail-panels.test.ts` beside this file reads the panels' own
 * sources and checks each id is there.
 *
 * The order is §7.0's and it is also the page's own order, which is the rule
 * `app/(shell)/AGENTS.md` states: a rail row carries the name its screen carries, so the row
 * reading "Members" sits above the panel headed "Members".
 */
export interface WorkspaceRailPanel {
  /** The heading id the row's fragment names, as the panel renders it. */
  readonly anchor: string;
  /**
   * The row's label, which is the panel's own heading string.
   *
   * Typed as a catalog key rather than a `string`, so a key the catalog does not have is a
   * compile error rather than a row rendering its own key on screen. The test beside this
   * file asserts the four are present anyway, because a type cannot say the heading the key
   * resolves to is the one the panel shows.
   */
  readonly labelKey: MessageKey;
  /** The panel component the id lives in, repo-relative, for the gate beside this. */
  readonly source: string;
}

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
