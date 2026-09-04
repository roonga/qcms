import type { MessageKey } from "./i18n/en.ts";

/**
 * The sections of the Settings screen, as data (issue 655, rebuilding issue 562's screen to
 * `plan/admin-shell-poc/settings-newquestion-poc.html`).
 *
 * ## What the POC draws, and why the old shape was wrong
 *
 * The POC states its own intent in a comment on `.topbar`: account, change password and
 * two-factor authentication are "three genuinely separate surfaces, and stacking all three
 * in one scroll was hiding that". So a section is a PANEL, exactly one of which is on screen
 * at a time, and the rail is what switches between them. Before this change all three were
 * stacked in one scroll and the rail was three fragment anchors into it.
 *
 * ## One list, three readers, and that is the whole reason this file exists
 *
 * The rail renders a button per section, the screen renders a panel per section, and the
 * page heading names whichever one is showing. Written three times they drift, so the ids,
 * the panel element ids and the names are decided here and all three sides read them.
 *
 * ## Why the ids are literal strings and not derived from anything
 *
 * `change-password` is already a published anchor: the account menu's Change password item
 * links to `/settings#change-password` (`components/account-menu.tsx`), and that link is
 * part of that control's contract rather than decoration. The panel rebuild keeps it working
 * by reading the fragment as the section to open with, so the id it already has is the id it
 * keeps and the other two are written in the same shape beside it.
 *
 * ## Why the panel element ids are a separate field
 *
 * The POC names its three panels `settings-panel-account`, `settings-panel-password` and
 * `settings-panel-twofactor`, and those are not `settings-panel-` plus the section id: its
 * panel ids were written fresh, while two of the section ids carry the URL history above.
 * Deriving one from the other would have meant renaming either the published anchor or the
 * POC's panels, so both are written out and neither is guessed at.
 *
 * ## The list is static, including the recovery-codes form
 *
 * Regenerating recovery codes is a subheading inside the two-factor panel and only renders
 * for an enrolled account. It is not a section: promoting it would give the rail a row that
 * appears and disappears with account state. Three sections, always.
 */

/** One section of the Settings screen: its id, its panel's id, and the name every side renders. */
export interface SettingsSection {
  /** The section's id: the fragment the account menu links to, and the switcher's key. */
  readonly id: SettingsSectionId;
  /** The `id` the panel element carries, taken verbatim from the POC. */
  readonly panelId: string;
  /** The catalog key for the section's name (ADR-27: no user-facing string is a literal). */
  readonly labelKey: MessageKey;
}

/**
 * The three ids, named so the screen can reach for one without writing a string.
 *
 * The three panels are structurally different from each other, so the screen cannot render
 * itself by mapping over {@link SETTINGS_SECTIONS} the way the rail does. Naming the ids
 * here is what keeps the sides from drifting anyway.
 */
export const SETTINGS_SECTION_IDS = {
  account: "account",
  // The value is the anchor `components/account-menu.tsx` already links to. Nothing reads it
  // as a secret and nothing compares it to one; the property is named for the section, and
  // the section is the password one.
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a URL fragment, not a credential
  changePassword: "change-password",
  twoFactor: "two-factor",
} as const;

/** One of the three sections, as a type the switcher and both components can hold. */
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[keyof typeof SETTINGS_SECTION_IDS];

/**
 * The section the screen opens with when the URL asks for none.
 *
 * The POC's own resting state: Account carries `aria-current="page"` and its panel is the
 * one without `hidden`.
 */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = SETTINGS_SECTION_IDS.account;

/**
 * The three sections, in the order the rail lists them.
 *
 * Reading order is the contract: the rail reads top to bottom and the switcher's keys are
 * this list, so a rail whose rows were in a different order than the panels would be a
 * second opinion about the shape of the screen.
 */
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

/** The one `id` the page heading carries, which every panel is named by. */
export const SETTINGS_HEADING_ID = "settings-page-heading";

/** The section with this id, or `undefined` when nothing here is called that. */
export function settingsSectionById(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}

/**
 * The catalog key naming a section, which is what the page heading renders.
 *
 * The argument is the union of the three ids this file itself declares, so the lookup cannot
 * miss. The throw is there to say that out loud rather than to be caught: a fallback string
 * would let a section added to {@link SETTINGS_SECTION_IDS} and forgotten in
 * {@link SETTINGS_SECTIONS} render a heading that names the wrong thing.
 */
export function settingsSectionLabelKey(id: SettingsSectionId): MessageKey {
  const section = settingsSectionById(id);
  if (section === undefined) throw new Error(`no Settings section is called ${id}`);
  return section.labelKey;
}

/**
 * The section a URL fragment names, or `undefined` when it names none.
 *
 * A fragment is never sent to a server, so this is read in the browser after the first
 * paint. It exists because `/settings#change-password` is a link the account menu has
 * shipped since task 032: under the stacked screen it scrolled, and under the panel screen
 * it selects. The URL contract is unchanged either way.
 */
export function settingsSectionFromHash(hash: string): SettingsSectionId | undefined {
  return settingsSectionById(hash.replace(/^#/u, ""))?.id;
}

/**
 * The section a Settings URL's query names, which is where a POST lands its reader.
 *
 * Four of this screen's messages arrive as redirect markers rather than as renders:
 * `?changed=1`, `?error=1` and `?compromised=1` from `/settings/password`, and
 * `?codesError=1` from `/settings/recovery-codes`. Each one belongs to a panel, and a panel
 * screen that opened on Account after a password change would hide the confirmation that the
 * change happened. So the marker chooses the panel, on the server, in the same render that
 * draws the message. `?compromised=1` is the breached-password refusal (issue #437) and
 * belongs to the same panel as the other two: a message an operator cannot see is the defect
 * that issue exists to close, so it must not be one redirect away from being invisible again.
 */
export function settingsSectionFromParams(
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
): SettingsSectionId {
  if (
    params.changed !== undefined ||
    params.error !== undefined ||
    params.compromised !== undefined
  ) {
    return SETTINGS_SECTION_IDS.changePassword;
  }
  if (params.codesError !== undefined) return SETTINGS_SECTION_IDS.twoFactor;
  return DEFAULT_SETTINGS_SECTION;
}
