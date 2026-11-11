import { RailFrame, RailTree } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import {
  ALL_WORKSPACES_PATH,
  workspaceAreaLabel,
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
 * With one workspace there is no list to go back to, so the area names itself in the singular
 * and offers no way to one.
 */
export function WorkspacesRail({
  workspace,
  section,
  multiple = true,
}: {
  readonly workspace?: WorkspaceRailRow;
  readonly section?: WorkspaceSection;
  readonly multiple?: boolean;
}) {
  const subject = t(workspaceAreaLabel(multiple));
  return (
    <RailFrame
      subject={subject}
      testId="qcms-workspaces-rail"
      {...(section === undefined || !multiple
        ? {}
        : {
            context: { href: ALL_WORKSPACES_PATH, label: t("membership.workspace.allWorkspaces") },
          })}
      crumbs={{
        workspaceArea: subject,
        ...(workspace === undefined ? {} : { workspace: workspace.name }),
      }}
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
