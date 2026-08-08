"use client";

import { useState, useTransition } from "react";

import { Alert, Button, Checkbox, NumberField } from "@/components/kit";
import { IDLE_SETTINGS, type SettingsState } from "@/lib/forms/builder-state";
import type { FormSettings } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The per-form abuse controls (task 033; ADR-24 tier 2, task 026).
 *
 * ## Why the unenforceable warning is not optional
 *
 * A challenge is a **deployment** capability. Ticking `challengeRequired` on a form whose
 * deployment has `challengeProvider: "none"` configures nothing: the session start has no
 * provider to call, so the setting is stored and then ignored. A switch that silently
 * promises protection it cannot deliver is worse than no switch, so the panel says so
 * inline, next to the control, whenever the provider is `none` (task file line 26).
 *
 * ## Why `minSubmitMs: null` is a value rather than an omission
 *
 * `null` means "use the deployment's floor" and a number means "use this one", so the
 * checkbox that clears the field has to send `null` rather than dropping the key. The
 * action forwards only the keys that changed (the API rejects an empty patch at the schema
 * level), which is why this panel tracks what the author actually touched instead of
 * posting both keys every time.
 *
 * ## Save, not autosave
 *
 * The draft autosaves because it is a document under construction. These two are
 * deployment-facing switches, so they take an explicit press: an accidental keystroke in
 * the milliseconds field should not quietly change what a live form demands of a
 * respondent.
 */
export function FormSettingsPanel({
  settings,
  challengeProvider,
  updateSettings,
}: {
  readonly settings: FormSettings;
  readonly challengeProvider: string;
  readonly updateSettings: (patch: {
    challengeRequired?: boolean;
    minSubmitMs?: number | null;
  }) => Promise<SettingsState>;
}) {
  // `stored` is what the API last confirmed, `draft` is what is on screen. Both live here
  // rather than the first coming from the prop, because the prop only refreshes on the next
  // server render: without it, a saved change would keep reading as unsaved.
  const [stored, setStored] = useState<FormSettings>(settings);
  const [draft, setDraft] = useState<FormSettings>(settings);
  const [state, setState] = useState<SettingsState>(IDLE_SETTINGS);
  const [isPending, startTransition] = useTransition();

  const usesDefault = draft.minSubmitMs === null;
  const changed = patchOf(stored, draft);
  const hasChange = Object.keys(changed).length > 0;

  return (
    <details className="rounded-md border border-(--color-border) bg-(--color-surface) p-4" open>
      <summary className="cursor-pointer text-base font-semibold text-(--color-text)">
        {t("forms.settings.title")}
      </summary>

      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-(--color-text-muted)">{t("forms.settings.note")}</p>

        <div className="flex flex-col gap-2">
          <Checkbox
            label={t("forms.settings.challengeRequired")}
            isSelected={draft.challengeRequired}
            onChange={(isSelected) => {
              // Functional form for the reason the bench records: a handler that spreads
              // the state it closed over loses a sibling change made in the same tick.
              setDraft((previous) => ({ ...previous, challengeRequired: isSelected }));
            }}
          />
          <p className="text-sm text-(--color-text-muted)">{t("forms.settings.challengeHint")}</p>
          {challengeProvider === "none" && draft.challengeRequired && (
            <div data-testid="qcms-challenge-unenforceable">
              <Alert variant="warning">{t("forms.settings.challengeUnenforceable")}</Alert>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Checkbox
            label={t("forms.settings.minSubmitDefault")}
            isSelected={usesDefault}
            onChange={(isSelected) => {
              setDraft((previous) => ({
                ...previous,
                minSubmitMs: isSelected ? null : (stored.minSubmitMs ?? 0),
              }));
            }}
          />
          {!usesDefault && (
            <NumberField
              label={t("forms.settings.minSubmit")}
              description={t("forms.settings.minSubmitHint")}
              value={draft.minSubmitMs ?? 0}
              minValue={0}
              onChange={(next) => {
                setDraft((previous) => ({
                  ...previous,
                  minSubmitMs: Number.isFinite(next) ? next : 0,
                }));
              }}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="md"
            isDisabled={isPending || !hasChange}
            onPress={() => {
              startTransition(async () => {
                const result = await updateSettings(changed);
                setState(result);
                if (result.settings !== undefined) {
                  setStored(result.settings);
                  setDraft(result.settings);
                }
              });
            }}
          >
            {t("forms.settings.save")}
          </Button>
          {/* Testid on the region as well as on its sentence, so the `aria-live` can be
              asserted directly (#368). */}
          <p
            aria-live="polite"
            className="text-sm text-(--color-text-muted)"
            data-testid="qcms-form-settings-status"
          >
            <span data-testid="qcms-settings-state">{settingsSummary(state)}</span>
          </p>
        </div>
      </div>
    </details>
  );
}

/** What one save reported, in a sentence, or nothing before the first one. */
function settingsSummary(state: SettingsState): string {
  if (state.status === "saved") return t("forms.settings.saved");
  if (state.status === "error") return t("forms.settings.failed", { message: state.message ?? "" });
  return "";
}

/** Only the keys the author actually changed: the API refuses an empty patch. */
function patchOf(
  stored: FormSettings,
  draft: FormSettings,
): { challengeRequired?: boolean; minSubmitMs?: number | null } {
  return {
    ...(stored.challengeRequired === draft.challengeRequired
      ? {}
      : { challengeRequired: draft.challengeRequired }),
    ...(stored.minSubmitMs === draft.minSubmitMs ? {} : { minSubmitMs: draft.minSubmitMs }),
  };
}
