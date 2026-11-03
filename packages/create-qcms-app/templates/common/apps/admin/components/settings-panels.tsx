"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
import { resetSettingsPanel, selectSettingsPanel, useSettingsPanel } from "@/lib/settings-panel";
import type { SettingsSectionId } from "@/lib/settings-sections";
import {
  SETTINGS_HEADING_ID,
  SETTINGS_SECTIONS,
  settingsSectionFromHash,
  settingsSectionLabelKey,
} from "@/lib/settings-sections";

export function SettingsPanels({
  initial,
  panels,
}: {
  readonly initial: SettingsSectionId;
  readonly panels: Readonly<Record<SettingsSectionId, ReactNode>>;
}) {
  const selected = useSettingsPanel(initial);

  useEffect(() => {
    const read = (): void => {
      const fromHash = settingsSectionFromHash(globalThis.location.hash);
      if (fromHash !== undefined) selectSettingsPanel(fromHash);
    };
    read();
    globalThis.addEventListener("hashchange", read);
    return () => {
      globalThis.removeEventListener("hashchange", read);
      // Reset module panel selection on unmount so it cannot override the next visit's URL.
      resetSettingsPanel();
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 id={SETTINGS_HEADING_ID} className="text-xl font-semibold text-(--color-text)">
        {t(settingsSectionLabelKey(selected))}
      </h1>
      {SETTINGS_SECTIONS.map((section) => (
        <div
          key={section.id}
          id={section.panelId}
          className="qcms-settings-panel"
          hidden={section.id !== selected}
        >
          {panels[section.id]}
        </div>
      ))}
    </div>
  );
}
