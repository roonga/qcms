import Link from "next/link";

import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { MY_ACCESS_PATH } from "@/lib/shell/modes";

export interface WorkspaceRailRow {
  readonly workspaceId: string;
  readonly name: string;
}

export function WorkspacesRail({
  workspaces,
}: {
  readonly workspaces: readonly WorkspaceRailRow[];
}) {
  return (
    <RailFrame
      subject={t("membership.area.title")}
      title={t("membership.area.title")}
      testId="qcms-workspaces-rail"
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          {workspaces.map((workspace) => (
            <li key={workspace.workspaceId}>
              <Link
                href={`/workspaces/${encodeURIComponent(workspace.workspaceId)}`}
                className="qcms-rail__link"
                data-rail-item={`workspace:${workspace.workspaceId}`}
              >
                {workspace.name}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={MY_ACCESS_PATH}
              className="qcms-rail__link"
              data-rail-item="section:my-access"
            >
              {t("access.title")}
            </Link>
          </li>
        </ul>
      }
    />
  );
}
