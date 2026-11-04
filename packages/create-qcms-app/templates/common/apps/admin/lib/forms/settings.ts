import type { FormSettings } from "./types.ts";

// null resets the submission floor to deployment default; omission leaves it unchanged.
export interface SettingsPatch {
  readonly challengeRequired?: boolean;
  readonly minSubmitMs?: number | null;
}

// Send only changes: the route refuses an empty patch, and echoing saved values would rearm autosave forever.
export function settingsPatch(stored: FormSettings, drafted: FormSettings): SettingsPatch {
  return {
    ...(stored.challengeRequired === drafted.challengeRequired
      ? {}
      : { challengeRequired: drafted.challengeRequired }),
    ...(stored.minSubmitMs === drafted.minSubmitMs ? {} : { minSubmitMs: drafted.minSubmitMs }),
  };
}

export function hasSettingsChange(patch: SettingsPatch): boolean {
  return Object.keys(patch).length > 0;
}
