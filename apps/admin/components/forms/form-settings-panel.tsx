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
 *
 * ## The summary carries a heading and a digest (issue 519)
 *
 * `plan/admin-ux-audit.md` §4.3: this panel and the test bench were the only two sections
 * on the builder with no entry in the heading outline, because a bare `<summary>` is not
 * a heading. The `h2` inside the summary is the level every other section of this page
 * uses (steps, step editor, rules, validation), so the outline now reads h1 form, h2
 * section, with no hole and no skip.
 *
 * The digest beside it is §3.7's, and its one hard rule is that a fact stated there must
 * also exist **inside** the panel: a collapsed `<details>` is removed from the
 * accessibility tree entirely, so a summary that is the only home of a value destroys
 * that value for anyone who has the panel shut. Both facts here are the panel's own
 * controls read back - the challenge checkbox and the minimum-time field - so the panel
 * is always the fuller copy.
 *
 * It reads the **draft** rather than the last confirmed settings for the same reason:
 * the draft is what the controls below are showing, so the digest and the panel can
 * never disagree, in any state. And it says nothing about saving. `plan/admin-design-contracts.md`
 * §6 gives an autosaving screen exactly one save statement, and on the builder that is
 * the ambient strip; a "saved" or "unsaved" word here would be a second one.
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

  // NOT A DISCLOSURE ANY MORE (Code Owner, 2026-08-26). It was a `<details>` because it
  // shared a screen with four other panels and something had to give way; the form's
  // details screen carries the settings and little else now, so collapsing them buys a
  // row of nothing and costs a press.
  //
  // The digest stays beside the heading. It was there to say what the panel held while
  // it was shut, and it still earns its place open: it is the settings as one sentence,
  // which is faster to check than reading three controls. `plan/admin-ux-audit.md` §3.7
  // wants the digest and the controls to agree, and open they plainly do.
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
          {settingsDigest(draft)}
        </span>
      </div>

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
    </section>
  );
}

/**
 * The two facts this panel holds, in the summary's own words (issue 519).
 *
 * Read from the draft, which is what the controls below are showing, so every fact
 * stated here is visible inside the panel the moment it is opened (§3.7). No judgement
 * and no save claim: "Challenge required, minimum time 800 ms", never "needs attention".
 */
function settingsDigest(draft: FormSettings): string {
  return t("forms.settings.digest", {
    challenge: t(
      draft.challengeRequired
        ? "forms.settings.digest.challengeOn"
        : "forms.settings.digest.challengeOff",
    ),
    minSubmit:
      draft.minSubmitMs === null
        ? t("forms.settings.digest.minSubmitDefault")
        : t("forms.settings.digest.minSubmitValue", { ms: draft.minSubmitMs }),
  });
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
