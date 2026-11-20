import Link from "next/link";
import type { ReactNode } from "react";

import { RailFrame, RailTree } from "@/components/rail-frame";
import { t, type MessageKey } from "@/lib/i18n/en";
import {
  ALL_WORKSPACES_PATH,
  workspaceAreaLabel,
  WORKSPACE_SECTION_LABELS,
  WORKSPACE_SECTIONS,
  workspaceSectionHref,
  type WorkspaceSection,
} from "@/lib/membership/sections";
import {
  membersGrantHref,
  newGroupHref,
  type WorkspaceSubView,
} from "@/lib/membership/workspace-views";

export interface WorkspaceRailRow {
  readonly workspaceId: string;
  readonly name: string;
}

const SUB_ROWS: Partial<
  Record<
    WorkspaceSection,
    {
      readonly view: WorkspaceSubView;
      readonly label: MessageKey;
      readonly name: MessageKey;
      readonly href: (workspaceId: string) => string;
    }
  >
> = {
  members: {
    view: "grant",
    label: "membership.grant.heading",
    name: "membership.grant.railName",
    href: membersGrantHref,
  },
  "access-groups": {
    view: "new",
    label: "membership.rail.new",
    name: "membership.groups.new",
    href: newGroupHref,
  },
};

/**
 * The Workspaces area rail: the current workspace's sections, and inside one of them the way
 * back to the full list. The switcher in the top bar is the only chooser, so none is named here.
 * With one workspace there is no list to go back to, so the area names itself in the singular
 * and offers no way to one.
 */
export function WorkspacesRail({
  workspace,
  section,
  sub,
  multiple = true,
  filters,
}: {
  readonly workspace?: WorkspaceRailRow;
  readonly section?: WorkspaceSection;
  readonly sub?: WorkspaceSubView | undefined;
  readonly multiple?: boolean;
  readonly filters?: ReactNode;
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
      {...(filters === undefined ? {} : { filters })}
      {...(workspace === undefined
        ? {}
        : {
            sections: (
              <RailTree
                items={WORKSPACE_SECTIONS.map((entry) => {
                  const row = SUB_ROWS[entry];
                  const onSub = entry === section && row !== undefined && sub === row.view;
                  return {
                    key: `section:${entry}`,
                    href: workspaceSectionHref(workspace.workspaceId, entry),
                    label: t(WORKSPACE_SECTION_LABELS[entry]),
                    current: entry === section && !onSub,
                    ...(row === undefined
                      ? {}
                      : {
                          expanded: true,
                          children: (
                            <ul className="qcms-rail__group">
                              <li>
                                <Link
                                  href={row.href(workspace.workspaceId)}
                                  className="qcms-rail__link"
                                  data-rail-item={`section:${entry}:${row.view}`}
                                  aria-label={t(row.name)}
                                  {...(onSub ? { "aria-current": "page" as const } : {})}
                                >
                                  {t(row.label)}
                                </Link>
                              </li>
                            </ul>
                          ),
                        }),
                  };
                })}
              />
            ),
          })}
    />
  );
}
