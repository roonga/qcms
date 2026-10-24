import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { WORKSPACE_RAIL_PANELS } from "@/lib/membership/rail-panels";

/**
 * The workspace detail screen's parts of the one rail (`plan/admin-design-contracts.md` §7.0,
 * Code Owner 2026-10-24; issue #1117).
 *
 * §7.0's table: "Workspace detail | back to Workspaces, workspace name | Members, Access
 * groups, Workspace settings, Access audit | - | -".
 *
 * - **Header:** the way back to Workspaces, which ruling 3 makes the Header's job, and the
 *   workspace's name - so the content column's own "All workspaces" link is gone.
 * - **Sections:** the four panels, as same-page anchors onto the heading ids the panels
 *   already render, so nothing in `components/membership/` had to grow an id for a rail to
 *   point at. Which four and which ids is `lib/membership/rail-panels.ts`, with the gate
 *   beside it that checks each fragment resolves - a fragment matching nothing fails
 *   silently, and the other end of that equality is a file this rail does not own.
 * - **Filters** and **Actions:** none. Every act on this screen writes a grant or a setting,
 *   and §7.0 ruling 5 keeps a write out of the rail: they stay in the panel that performs
 *   them, beside what they change.
 *
 * ## What this answers that §7a's "four authorities" objection raised
 *
 * `lib/rail-routes.test.ts` used to record why this screen had no rail: "four panels in one
 * scroll and each is a different authority, which is a shape the Settings exception does not
 * cover". The panels are still four authorities and the rail does not claim otherwise - it
 * navigates between them and says nothing about who may read which. What each panel renders
 * when its own read was refused is unchanged, which is the half that carried that argument:
 * a row reaching a panel that says "the access audit could not be read" is the panel
 * speaking for itself, exactly as it does today when an operator scrolls to it.
 *
 * A server component: the name is a fact about the route, read by the slot.
 */
export function WorkspaceRail({ name }: { readonly name: string }) {
  return (
    <RailFrame
      subject={name}
      back={{ href: "/workspaces", label: t("membership.area.title") }}
      title={name}
      testId="qcms-workspace-rail"
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          {WORKSPACE_RAIL_PANELS.map((panel) => (
            <li key={panel.anchor}>
              <a
                href={`#${panel.anchor}`}
                className="qcms-rail__link"
                data-rail-item={`section:${panel.anchor}`}
              >
                {t(panel.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      }
    />
  );
}
