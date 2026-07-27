/**
 * Admin shell message catalog (task 031) - owned source, single locale (en).
 *
 * Same structure as the portal's catalog (ADR-11): a flat map of dotted keys to
 * templates. Only shell and auth chrome lives here. A second locale is a new
 * catalog module selected by the same key set; the launch cut-line has one (R7).
 *
 * Two families of string are worded on purpose rather than for tone:
 *
 * - **`signIn.error` and `signIn.throttled`** are the only failure messages the
 *   sign-in and 2FA screens can render. They say nothing about which factor was
 *   wrong or whether the account exists, because SEC-1 requires an unknown email
 *   and a wrong password to be indistinguishable. Making them one string each is
 *   what stops a future edit from adding a helpful, enumerating variant.
 * - **`recovery.*`** never promises the codes can be seen again, because they
 *   cannot: better-auth stores them for verification, and this is their one
 *   display.
 */

export const messages = {
  "app.title": "QCMS admin",
  "app.description": "Author questionnaires, publish forms, and review responses.",

  "action.skipToContent": "Skip to content",
  "action.signIn": "Sign in",
  "action.signOut": "Sign out",
  "action.verify": "Verify",
  "action.continue": "Continue",
  "action.savePassword": "Change password",

  "nav.label": "Admin sections",
  "nav.questions": "Questions",
  "nav.forms": "Forms",
  "nav.responses": "Responses",
  "nav.webhooks": "Webhooks",
  "nav.settings": "Settings",

  "signIn.title": "Sign in to QCMS admin",
  "signIn.email": "Email",
  "signIn.password": "Password",
  // One message for every failure: wrong password, unknown email, wrong TOTP code,
  // wrong recovery code (SEC-1, no enumeration).
  "signIn.error": "Those details did not match. Please try again.",
  "signIn.throttled": "Too many attempts. Please try again later.",
  "signIn.expired": "Your session expired. Please sign in again.",

  "enroll.title": "Set up two-factor authentication",
  "enroll.intro":
    "Scan this code with your authenticator app, then enter the six-digit code it shows.",
  "enroll.qrAlt": "QR code for enrolling this account in your authenticator app",
  "enroll.manualLabel": "Setup key (use this if you cannot scan the code)",
  "enroll.codeLabel": "Six-digit code from your app",

  "recovery.title": "Save your recovery codes",
  "recovery.intro":
    "Each code signs you in once if you lose your authenticator. This is the only time they are shown.",
  "recovery.listLabel": "Recovery codes",
  "recovery.confirm": "I have saved these codes",

  "challenge.title": "Two-factor authentication",
  "challenge.intro": "Enter the six-digit code from your authenticator app.",
  "challenge.codeLabel": "Six-digit code",
  "challenge.useRecovery": "Use a recovery code instead",

  "recoveryEntry.title": "Use a recovery code",
  "recoveryEntry.intro": "Enter one of the recovery codes you saved during setup.",
  "recoveryEntry.codeLabel": "Recovery code",
  "recoveryEntry.useApp": "Use your authenticator app instead",

  "settings.title": "Settings",
  "settings.account": "Account",
  "settings.signedInAs": "Signed in as {email}.",
  "settings.passwordTitle": "Change password",
  "settings.passwordIntro":
    "Changing your password signs out every other session on every device.",
  "settings.currentPassword": "Current password",
  "settings.newPassword": "New password",
  "settings.passwordChanged": "Your password was changed and other sessions were signed out.",
  "settings.twoFactorTitle": "Two-factor authentication",
  "settings.twoFactorOn": "Two-factor authentication is on for this account.",
  "settings.twoFactorOff": "Two-factor authentication is not set up for this account.",

  // The area screens tasks 032-035 replace. Each says what it will hold so the
  // shell is navigable and reviewable now, and so an empty page never reads as a
  // bug during the screenshot gate.
  "area.questions.title": "Questions",
  "area.questions.pending": "The question library lands in task 032.",
  "area.forms.title": "Forms",
  "area.forms.pending": "The form builder and condition editor land in task 033.",
  "area.responses.title": "Responses",
  "area.responses.pending": "Response browsing, export, and erasure land in task 035.",
  "area.webhooks.title": "Webhooks",
  "area.webhooks.pending": "Webhook configuration and delivery history land in task 035.",
} as const;

export type MessageKey = keyof typeof messages;

/** Resolve a message, substituting `{name}` placeholders. */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template: string = messages[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
