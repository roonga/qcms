import type { MessageKey } from "./i18n/en.ts";

/**
 * The sections of the Settings screen, as data (`plan/admin-design-contracts.md` §7a,
 * issue 562).
 *
 * ## One list, two readers, and that is the whole reason this file exists
 *
 * The Settings rail is a list of anchors into the Settings page, so the page and the rail
 * have to agree about which sections exist and what each one is called. Written twice they
 * drift, and the drift is silent: a rail row pointing at a fragment nothing carries scrolls
 * nowhere and marks nothing current. So the ids and the labels are decided here and both
 * sides read them.
 *
 * ## Why the ids are literal strings and not derived from anything
 *
 * `change-password` is already a published anchor: the account menu's Change password item
 * links to `/settings#change-password` (`components/account-menu.tsx`), and that link is
 * part of that control's contract rather than decoration. An id scheme that renamed it
 * would break a working link for the sake of tidiness, so the id it already has is the id
 * it keeps, and the other two are written in the same shape beside it.
 *
 * ## Why this is not `lib/forms/subtree-rail.ts` with different rows
 *
 * §7a is explicit that the Settings rail is "a second, narrower component that happens to
 * occupy the same grid column", not the §7 rail on another screen, and that the two share
 * "the grid column, the 240px width, the `--bp-sidebar` collapse behaviour and the
 * anchors-not-buttons rule - and nothing else". The two data shapes look similar and mean
 * different things: a §7 row is a ROUTE with an issue count, and a row here is a FRAGMENT
 * on the route you are already on, with no count and no action. A common type over the two
 * would be the seam along which the exception quietly becomes a third rail contract, which
 * is the one thing the ruling that granted the exception forbade.
 *
 * ## The list is static, including the recovery-codes form
 *
 * Regenerating recovery codes is an `<h3>` inside the two-factor card and only renders for
 * an enrolled account. It is not a section: promoting it would give the rail a row that
 * appears and disappears with account state, and would make the `:target` rules in
 * `app/globals.css` conditional on something the stylesheet cannot see. Three sections,
 * always, matching the three `<h2>`s the screen has always had.
 */

/** One section of the Settings screen: its DOM id, and the name both readers render. */
export interface SettingsSection {
  /** The fragment a rail row points at, and the `id` the section element carries. */
  readonly id: string;
  /** The catalog key for the section's name (ADR-27: no user-facing string is a literal). */
  readonly labelKey: MessageKey;
}

/**
 * The three ids, named so the screen can reach for one without writing a string.
 *
 * The page's three cards are structurally different from each other, so the screen cannot
 * render itself by mapping over {@link SETTINGS_SECTIONS} the way the rail does. Naming the
 * ids here is what keeps the two sides from drifting anyway: the page spells `account` by
 * asking for it rather than by retyping it, so an id that changes here changes there.
 */
export const SETTINGS_SECTION_IDS = {
  account: "account",
  // The value is the anchor `components/account-menu.tsx` already links to and the `id` the
  // section element renders. Nothing reads it as a secret and nothing compares it to one;
  // the property is named for the section, and the section is the password one.
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- a DOM fragment id, not a credential
  changePassword: "change-password",
  twoFactor: "two-factor",
} as const;

/**
 * The three sections, in the order they appear down the page.
 *
 * Document order is the contract: the rail reads top to bottom and so does the screen, and
 * a rail whose rows were in a different order than the sections would be a second opinion
 * about the shape of the page.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: SETTINGS_SECTION_IDS.account, labelKey: "settings.account" },
  { id: SETTINGS_SECTION_IDS.changePassword, labelKey: "settings.passwordTitle" },
  { id: SETTINGS_SECTION_IDS.twoFactor, labelKey: "settings.twoFactorTitle" },
];

/** The `id` of the `<h2>` that names a section, and so the section's accessible name. */
export function settingsSectionHeadingId(id: string): string {
  return `${id}-heading`;
}
