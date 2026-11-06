import Link from "next/link";

import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import {
  WORKSPACE_SECTION_LABELS,
  WORKSPACE_SECTIONS,
  workspaceHref,
  workspaceSectionHref,
  type WorkspaceSection,
} from "@/lib/membership/sections";

export interface WorkspaceRailRow {
  readonly workspaceId: string;
  readonly name: string;
}

function current(on: boolean) {
  return on ? { "aria-current": "page" as const } : {};
}

/**
 * The Workspaces area rail. A lone workspace is always expanded; several form an accordion with
 * the current one (or the first, on the list) open. Two levels at most and no back link.
 */
export function WorkspacesRail({
  workspaces,
  selected,
}: {
  readonly workspaces: readonly WorkspaceRailRow[];
  readonly selected?: { readonly workspaceId: string; readonly section: WorkspaceSection };
}) {
  const selectedName = workspaces.find(
    (workspace) => workspace.workspaceId === selected?.workspaceId,
  )?.name;
  const openWorkspaceId = selected?.workspaceId ?? workspaces[0]?.workspaceId;
  return (
    <RailFrame
      subject={t("membership.area.title")}
      testId="qcms-workspaces-rail"
      {...(selectedName === undefined ? {} : { crumbs: { workspace: selectedName } })}
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          {workspaces.map((workspace) => {
            const open = workspace.workspaceId === openWorkspaceId;
            const sections = (
              <ul className="qcms-rail__group pl-3" data-rail-group="workspace-sections">
                {WORKSPACE_SECTIONS.map((section) => (
                  <li key={section}>
                    <Link
                      href={workspaceSectionHref(workspace.workspaceId, section)}
                      className="qcms-rail__link"
                      data-rail-item={`section:${section}`}
                      {...current(
                        selected?.workspaceId === workspace.workspaceId &&
                          selected.section === section,
                      )}
                    >
                      {t(WORKSPACE_SECTION_LABELS[section])}
                    </Link>
                  </li>
                ))}
              </ul>
            );
            return (
              <li key={workspace.workspaceId}>
                {workspaces.length === 1 ? (
                  <>
                    <Link
                      href={workspaceHref(workspace.workspaceId)}
                      className="qcms-rail__link"
                      data-rail-item={`workspace:${workspace.workspaceId}`}
                      aria-expanded
                    >
                      {workspace.name}
                    </Link>
                    {sections}
                  </>
                ) : (
                  <details
                    name="qcms-workspaces-accordion"
                    className="qcms-rail__accordion"
                    open={open}
                  >
                    <summary
                      className="qcms-rail__link"
                      data-rail-item={`workspace:${workspace.workspaceId}`}
                    >
                      {workspace.name}
                    </summary>
                    {sections}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}
