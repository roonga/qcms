"use client";

import { useState } from "react";

import { Alert, Checkbox, NumberField } from "@/components/kit";
import type { FormSettings } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The per-form abuse controls (task 033; ADR-24 tier 2, task 026).
 *
 * ## Why the unenforceable warning is not optional
 *
 * A challenge is a **deployment** capability. Ticking `challengeRequired` on a deployment
 * that cannot verify a challenge configures nothing: the session start has nothing to call,
 * so the setting is stored and then ignored. A switch that silently promises protection it
 * cannot deliver is worse than no switch, so the panel says so inline, next to the control,
 * whenever the deployment reports the challenge unenforceable (task file line 26).
 *
 * The panel reads a **behavior**, `challengeEnforceable`, and not a provider name. It used
 * to compare a raw `challengeProvider` against `"none"`, which meant a deployment flag's
 * value crossed the wire into the admin; ADR-24 says clients receive behavior, not flag
 * values, and the Code Owner removed that exception on 2026-08-31 (issue #725). The API
 * derives the boolean beside the flag, so a new provider never needs a matching edit here.
 *
 * ## Why `minSubmitMs: null` is a value rather than an omission
 *
 * `null` means "use the deployment's floor" and a number means "use this one", so the
 * checkbox that clears the field has to send `null` rather than dropping the key. The
 * action forwards only the keys that changed (the API rejects an empty patch at the schema
 * level), which is `lib/forms/settings.ts`'s job now that the save itself is the builder's.
 *
 * ## Autosave, and therefore no state of its own (Code Owner, 2026-08-29)
 *
 * This panel used to persist itself: its own copy of the settings, its own bound action,
 * its own Save button and its own "Settings saved." It is presentational now - a value and
 * a callback - and `FormBuilder` holds the settings beside the draft and saves both on the
 * same debounce. `plan/admin-design-contracts.md` §6 records the ruling and what it costs.
 *
 * Two consequences are worth naming here, because they are why the state had to move
 * rather than merely why it could:
 *
 * - The builder's form screen unmounts when the reader selects a step in the rail. A
 *   debounce owned by this component would be cancelled by that unmount, and the edit
 *   waiting on it would be lost with no press to have been left unpressed. The builder
 *   does not unmount, so the save lands whichever screen the reader has moved to.
 * - There is no "Saved" and no timestamp anywhere below. The screen states when work was
 *   stored exactly once, in the ambient strip, and a settings save feeds that strip.
 *
 * ## What the live region says now
 *
 * A save that FAILED, and nothing else. With no button, a refused write has no press to
 * report back to, so the sentence is the only thing standing between an author and the
 * belief that a deployment switch is set when it is not. It is here rather than in the
 * builder's standing notices because it is announced: `aria-live` announces a change
 * inside a region that was already mounted, and this paragraph is mounted for as long as
 * the controls it describes are on screen.
 *
 * ## The summary carries a heading and a digest (issue 519)
 *
 * `plan/admin-ux-audit.md` §4.3: this panel and the test bench were the only two sections
 * on the builder with no entry in the heading outline, because a bare `<summary>` is not
 * a heading. The `h2` beside the digest is the level every other section of this page
 * uses (steps, step editor, rules, validation), so the outline reads h1 form, h2 section,
 * with no hole and no skip.
 *
 * The digest beside it is §3.7's, and its one hard rule is that a fact stated there must
 * also exist **inside** the panel. Both facts here are the panel's own controls read back -
 * the challenge checkbox and the minimum-time field - so the panel is always the fuller
 * copy. It reads the value the controls are bound to, so the digest and the panel can
 * never disagree, in any state. And it says nothing about saving.
 */
export function FormSettingsPanel({
  settings,
  challengeEnforceable,
  saveError,
  onChange,
}: {
  /** What the controls show: the builder's working copy, not the last confirmed one. */
  readonly settings: FormSettings;
  /** Whether this deployment can actually verify a challenge (ADR-24). */
  readonly challengeEnforceable: boolean;
  /** Why the last settings save was refused, or `undefined` while none has been. */
  readonly saveError: string | undefined;
  readonly onChange: (next: FormSettings) => void;
}) {
  const usesDefault = settings.minSubmitMs === null;
  // The last override the author had on screen, so that ticking "use the deployment's
  // minimum time" and unticking it again brings their number back rather than zero. The
  // panel used to read this off its own confirmed copy of the settings; under autosave
  // that copy has already been overwritten with `null` by the time the box is unticked,
  // which is exactly the value that must not be restored.
  const [lastOverride, setLastOverride] = useState<number>(settings.minSubmitMs ?? 0);

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
          {settingsDigest(settings)}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-4">
        <p className="text-sm text-(--color-text-muted)">{t("forms.settings.note")}</p>

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

      {/* A DIRECT CHILD OF THE SECTION, deliberately outside the gapped column above it.
          The paragraph is empty on the quiet path, and an empty child of a `gap-4` flex
          column still consumes a whole gap slot - the same 16px of nothing that
          `SaveNotices` and `FormNotices` were each measured carrying. Out here it is a
          block box with no content and no margin of its own, so it occupies nothing until
          the sentence inside it arrives with its own spacing.

          It stays mounted either way. A live region announces a change to a region that
          was already in the tree; one that appears alongside its first sentence usually
          announces nothing at all, which is the whole failure this element exists to
          avoid. Testid on the region as well as on its sentence, so the `aria-live` can
          be asserted directly (#368). */}
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

/**
 * The two facts this panel holds, in the summary's own words (issue 519).
 *
 * Read from the value the controls below are bound to, so every fact stated here is
 * visible inside the panel (§3.7). No judgement and no save claim: "Challenge required,
 * minimum time 800 ms", never "needs attention" and never "saved".
 */
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
