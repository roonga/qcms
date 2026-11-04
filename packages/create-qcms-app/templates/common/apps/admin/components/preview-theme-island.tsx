"use client";

import { useState, type ReactNode } from "react";

import { Select } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import {
  DEFAULT_PREVIEW_MODE,
  PREVIEW_MODES,
  PREVIEW_THEMES,
  parsePreviewMode,
  parsePreviewTheme,
  type PreviewMode,
  type PreviewTheme,
} from "@/lib/preview-theme";

/* Start from the deployment's respondent theme on every mount; remembering an exploration would
   misrepresent what it serves. */
export function PreviewThemeIsland({
  defaultTheme,
  frameLabel,
  children,
}: {
  readonly defaultTheme: PreviewTheme;
  readonly frameLabel?: string;
  readonly children: ReactNode;
}) {
  const [theme, setTheme] = useState<PreviewTheme>(defaultTheme);
  const [mode, setMode] = useState<PreviewMode>(DEFAULT_PREVIEW_MODE);

  return (
    <div className="qcms-preview-island" data-testid="qcms-preview-island">
      <div className="qcms-preview-switcher" data-testid="qcms-preview-switcher">
        <Select
          label={t("preview.island.theme")}
          value={theme}
          items={PREVIEW_THEMES.map((key) => ({
            label: t(`preview.island.theme.${key}`),
            value: key,
          }))}
          onChange={(next) => {
            setTheme(parsePreviewTheme(next) ?? defaultTheme);
          }}
        />
        <Select
          label={t("preview.island.mode")}
          value={mode}
          items={PREVIEW_MODES.map((key) => ({
            label: t(`preview.island.mode.${key}`),
            value: key,
          }))}
          onChange={(next) => {
            setMode(parsePreviewMode(next) ?? DEFAULT_PREVIEW_MODE);
          }}
        />
      </div>
      <Frame label={frameLabel}>
        <div
          className={`qcms-preview qcms-preview-surface ${mode}`}
          data-testid="qcms-preview-surface"
          data-qcms-theme-scope=""
          data-theme={theme}
        >
          {children}
        </div>
      </Frame>
    </div>
  );
}

/* The frame clips content; validation messages must stay outside it so none can be hidden. */
function Frame({
  label,
  children,
}: {
  readonly label: string | undefined;
  readonly children: ReactNode;
}) {
  if (label === undefined) return <>{children}</>;
  return (
    <div className="qcms-respondent-frame" data-testid="qcms-respondent-frame">
      <p className="qcms-respondent-frame__bar">{label}</p>
      {children}
    </div>
  );
}
