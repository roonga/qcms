"use client";

import { RailFrame } from "@/components/rail-frame";
import { t } from "@/lib/i18n/en";
import { useSettingsPanel } from "@/lib/settings-panel";
import type { SettingsSectionId } from "@/lib/settings-sections";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";

export function SettingsSectionRail({ initial }: { readonly initial: SettingsSectionId }) {
  const selected = useSettingsPanel(initial);

  return (
    <RailFrame
      subject={t("settings.title")}
      title={t("settings.title")}
      testId="qcms-settings-rail"
      sections={
        <ul className="qcms-rail__group" data-rail-group="sections">
          {SETTINGS_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="qcms-rail__link"
                id={`rail-${section.panelId}`}
                aria-controls={section.panelId}
                aria-current={section.id === selected ? "page" : undefined}
                data-rail-item={`section:${section.id}`}
                data-settings-rail-item={section.id}
              >
                {t(section.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      }
    />
  );
}
