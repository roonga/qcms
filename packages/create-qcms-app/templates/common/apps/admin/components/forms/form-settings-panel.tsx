"use client";

import { useState } from "react";

import { Alert, Checkbox, NumberField } from "@/components/kit";
import type { FormSettings } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { HeadingMarker } from "@/components/agent/heading-marker";

/* null explicitly requests the deployment floor; omitting the key leaves the previous override unchanged. */
export function FormSettingsPanel({
  settings,
  challengeEnforceable,
  saveError,
  onChange,
}: {
  readonly settings: FormSettings;
  readonly challengeEnforceable: boolean;
  readonly saveError: string | undefined;
  readonly onChange: (next: FormSettings) => void;
}) {
  const usesDefault = settings.minSubmitMs === null;
  // Retain the last numeric override separately so toggling the deployment floor off restores it after
  // autosave stores null.
  const [lastOverride, setLastOverride] = useState<number>(settings.minSubmitMs ?? 0);

  return (
    <section
      aria-labelledby="qcms-settings-heading"
      className="rounded-md border border-(--color-border) bg-(--color-surface) p-4"
    >
      <div>
        <h2
          id="qcms-settings-heading"
          className="inline text-base font-semibold text-(--color-text)"
        >
          {t("forms.settings.title")}
        </h2>
        <span
          className="ms-2 text-sm font-normal text-(--color-text-muted)"
          data-testid="qcms-settings-digest"
        >
          {settingsDigest(settings)}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-(--color-text-muted)">{t("forms.settings.note")}</p>

        <HeadingMarker control="builder.settings" block>
          <div className="flex flex-col gap-2">
            <Checkbox
              label={t("forms.settings.challengeRequired")}
              isSelected={settings.challengeRequired}
              onChange={(isSelected) => {
                onChange({ ...settings, challengeRequired: isSelected });
              }}
            />
            <p className="text-sm text-(--color-text-muted)">{t("forms.settings.challengeHint")}</p>
            {!challengeEnforceable && settings.challengeRequired && (
              <div data-testid="qcms-challenge-unenforceable">
                <Alert variant="warning">{t("forms.settings.challengeUnenforceable")}</Alert>
              </div>
            )}
          </div>
        </HeadingMarker>

        <div className="flex flex-col gap-2">
          <Checkbox
            label={t("forms.settings.minSubmitDefault")}
            isSelected={usesDefault}
            onChange={(isSelected) => {
              if (isSelected) {
                if (settings.minSubmitMs !== null) setLastOverride(settings.minSubmitMs);
                onChange({ ...settings, minSubmitMs: null });
                return;
              }
              onChange({ ...settings, minSubmitMs: lastOverride });
            }}
          />
          {!usesDefault && (
            <NumberField
              label={t("forms.settings.minSubmit")}
              description={t("forms.settings.minSubmitHint")}
              value={settings.minSubmitMs ?? 0}
              minValue={0}
              onChange={(next) => {
                onChange({ ...settings, minSubmitMs: Number.isFinite(next) ? next : 0 });
              }}
            />
          )}
        </div>
      </div>

      {/* Mount the empty live region before filling it; screen readers may miss a region introduced with its
   message. */}
      <p
        aria-live="polite"
        className="text-sm text-(--color-text-muted)"
        data-testid="qcms-form-settings-status"
      >
        {saveError !== undefined && (
          <span className="mt-3 block" data-testid="qcms-settings-state">
            {t("forms.settings.failed", { message: saveError })}
          </span>
        )}
      </p>
    </section>
  );
}

function settingsDigest(settings: FormSettings): string {
  return t("forms.settings.digest", {
    challenge: t(
      settings.challengeRequired
        ? "forms.settings.digest.challengeOn"
        : "forms.settings.digest.challengeOff",
    ),
    minSubmit:
      settings.minSubmitMs === null
        ? t("forms.settings.digest.minSubmitDefault")
        : t("forms.settings.digest.minSubmitValue", { ms: settings.minSubmitMs }),
  });
}
