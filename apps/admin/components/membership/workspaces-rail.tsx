import Link from "next/link";

import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";

/** One workspace, as the rail lists it. */
export interface WorkspaceRailRow {
  readonly workspaceId: string;
  readonly name: string;
}

/**
 * The workspaces screen's rail: a row per workspace, then the reader's own access
 * (`plan/admin-design-contracts.md` §7.0).
 *
 * The one list screen whose rail carries a row per thing: the list is the handful an
 * administrator administers and the body is panels rather than a scannable table, so a row
 * is navigation between siblings rather than a second copy of the page.
 */
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
            <a
              href="#qcms-my-access-heading"
              className="qcms-rail__link"
              data-rail-item="section:my-access"
            >
              {t("membership.mine.heading")}
            </a>
          </li>
        </ul>
      }
    />
  );
}
