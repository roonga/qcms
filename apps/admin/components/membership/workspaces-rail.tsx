import { RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import {
  ALL_WORKSPACES_PATH,
  WORKSPACE_SECTION_LABELS,
  WORKSPACE_SECTIONS,
  workspaceSectionHref,
  type WorkspaceSection,
} from "@/lib/membership/sections";

export interface WorkspaceRailRow {
  readonly workspaceId: string;
  readonly name: string;
}

/**
 * The Workspaces area rail: the current workspace's sections, and inside one of them the way
 * back to the full list. The switcher in the top bar is the only chooser, so none is named here.
 */
export function WorkspacesRail({
  workspace,
  section,
}: {
  readonly workspace?: WorkspaceRailRow;
  readonly section?: WorkspaceSection;
}) {
  return (
    <RailFrame
      subject={t("membership.area.title")}
      testId="qcms-workspaces-rail"
      {...(section === undefined
        ? {}
        : {
            // Inside one workspace only: on the full list it would point at the screen it is on.
            context: { href: ALL_WORKSPACES_PATH, label: t("membership.workspace.allWorkspaces") },
          })}
      {...(workspace === undefined ? {} : { crumbs: { workspace: workspace.name } })}
      {...(workspace === undefined
        ? {}
        : {
            sections: (
              <RailTree
                items={WORKSPACE_SECTIONS.map((entry) => ({
                  key: `section:${entry}`,
                  href: workspaceSectionHref(workspace.workspaceId, entry),
                  label: t(WORKSPACE_SECTION_LABELS[entry]),
                  current: entry === section,
                }))}
              />
            ),
          })}
    />
  );
}
