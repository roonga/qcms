import type { MessageKey } from "./i18n/en.ts";

/** Keep published fragment IDs distinct from panel element IDs; neither can be guessed from the other. Recovery regeneration remains inside the static two-factor section. */

export interface SettingsSection {
  readonly id: SettingsSectionId;

  readonly panelId: string;

  readonly labelKey: MessageKey;
}

export const SETTINGS_SECTION_IDS = {
  account: "account",
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a URL fragment, not a credential
  changePassword: "change-password",
  twoFactor: "two-factor",
} as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[keyof typeof SETTINGS_SECTION_IDS];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = SETTINGS_SECTION_IDS.account;

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: SETTINGS_SECTION_IDS.account,
    panelId: "settings-panel-account",
    labelKey: "settings.account",
  },
  {
    id: SETTINGS_SECTION_IDS.changePassword,
    panelId: "settings-panel-password",
    labelKey: "settings.passwordTitle",
  },
  {
    id: SETTINGS_SECTION_IDS.twoFactor,
    panelId: "settings-panel-twofactor",
    labelKey: "settings.twoFactorTitle",
  },
];

export const SETTINGS_HEADING_ID = "settings-page-heading";

export function settingsSectionById(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}

/** An unmapped declared section is a programming error; a fallback heading would name the wrong panel. */
export function settingsSectionLabelKey(id: SettingsSectionId): MessageKey {
  const section = settingsSectionById(id);
  if (section === undefined) throw new Error(`no Settings section is called ${id}`);
  return section.labelKey;
}

/** Read fragments in the browser because servers never receive them. */
export function settingsSectionFromHash(hash: string): SettingsSectionId | undefined {
  return settingsSectionById(hash.replace(/^#/u, ""))?.id;
}

/** Keep auth error and throttle markers distinct; only breach-corpus feedback may disclose a specific refusal. */
export const PASSWORD_PANEL_MARKERS: readonly string[] = [
  "changed",
  "error",
  "throttled",
  "compromised",
];

/** Use a separate marker pair so recovery-code refusals cannot appear under the password form; both pairs use the same opaque vocabulary. */
export const TWO_FACTOR_PANEL_MARKERS: readonly string[] = ["codesError", "codesThrottled"];

function carriesAnyOf(
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
  markers: readonly string[],
): boolean {
  return markers.some((marker) => params[marker] !== undefined);
}

/** Select the owning panel from redirect markers on the server so confirmations and refusals cannot arrive hidden. */
export function settingsSectionFromParams(
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
): SettingsSectionId {
  if (carriesAnyOf(params, PASSWORD_PANEL_MARKERS)) return SETTINGS_SECTION_IDS.changePassword;
  if (carriesAnyOf(params, TWO_FACTOR_PANEL_MARKERS)) return SETTINGS_SECTION_IDS.twoFactor;
  return DEFAULT_SETTINGS_SECTION;
}
