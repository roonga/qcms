import Link from "next/link";

import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";

/** One workspace, as the rail lists it. */
export interface WorkspaceRailRow {
  readonly workspaceId: string;
  readonly name: string;
}

/**
 * The workspaces screen's parts of the one rail (`plan/admin-design-contracts.md` §7.0,
 * Code Owner 2026-10-24; issue #1117).
 *
 * §7.0's table: "Workspaces | Workspaces | the workspace list, Your own access | - | -".
 *
 * ## This is the one list screen whose rail DOES carry a row per thing
 *
 * Which looks like the shape `plan/admin-ux-audit.md` §5.4 rejects - "it repeats the page's
 * own body, and now there are two of them and they can disagree" - and the ruled table asks
 * for it here anyway. The difference is what the body is. The two library screens list rows
 * an operator SCANS and filters, dozens of them, with the filters as the way through; this
 * screen lists the handful of workspaces one administrator administers, and its body is four
 * panels of substance about them rather than a table. A row per workspace is navigation
 * between siblings, which is what a Section is, and the audit's objection was to a rail
 * duplicating a scannable table.
 *
 * It is also why there is no Filters part here: a list this short has nothing to narrow.
 *
 * "Your own access" is the last Section and the one that is not a route: it is a same-page
 * anchor onto the panel's own heading id, which the page already carries
 * (`components/membership/my-access-panel.tsx`). It is the panel everybody gets whatever
 * their list says, so it sits under the list rather than above it.
 *
 * A server component. The list arrives from the slot, which reads it through the memoized
 * `listWorkspaces` the page reads.
 */
export function WorkspacesRail({ workspaces }: { readonly workspaces: readonly WorkspaceRailRow[] }) {
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
