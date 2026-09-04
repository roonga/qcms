import type { FormSettings } from "./types.ts";

/**
 * The keys `PATCH /admin/forms/:id/settings` accepts, all optional.
 *
 * `minSubmitMs: null` is a value rather than an omission - it means "use the deployment's
 * floor" - so the type is nullable *and* optional and the two mean different things.
 */
export interface SettingsPatch {
  readonly challengeRequired?: boolean;
  readonly minSubmitMs?: number | null;
}

/**
 * Only the settings the author actually changed.
 *
 * The route's schema refuses a body carrying neither key, so "nothing changed" has to be
 * an empty object the caller declines to send rather than a request the API answers with a
 * 400. It is also what makes the debounced save idempotent: once a save lands and the
 * stored value catches up with the drafted one, this returns `{}` and the autosave effect
 * has nothing left to do, which is what stops a save from arming the next one.
 *
 * Pure and separate from the panel that renders the controls, because the autosave that
 * consumes it lives in the builder now: one function, read from one place, testable
 * without a browser.
 */
export function settingsPatch(stored: FormSettings, drafted: FormSettings): SettingsPatch {
  return {
    ...(stored.challengeRequired === drafted.challengeRequired
      ? {}
      : { challengeRequired: drafted.challengeRequired }),
    ...(stored.minSubmitMs === drafted.minSubmitMs ? {} : { minSubmitMs: drafted.minSubmitMs }),
  };
}

/** Whether {@link settingsPatch} found anything to send. */
export function hasSettingsChange(patch: SettingsPatch): boolean {
  return Object.keys(patch).length > 0;
}
