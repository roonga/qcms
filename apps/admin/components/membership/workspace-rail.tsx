import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { WORKSPACE_RAIL_PANELS } from "@/lib/membership/rail-panels";

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
