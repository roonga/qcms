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
  "app.title": "QCMS",
  "app.description": "Author questionnaires, publish forms, and review responses.",

  "action.skipToContent": "Skip to content",
  "action.signIn": "Sign in",
  "action.signOut": "Sign out",
  "action.verify": "Verify",
  "action.continue": "Continue",
  "action.savePassword": "Change password",
  "action.changePassword": "Change password",

  // The colour-mode control (task 055; a menu since 032). Every label an operator
  // reads goes through here, mode names included (ADR-27) - a control that exists to
  // make the app usable is the last one that should be hard-coded to English.
  "appearance.mode.legend": "Appearance",
  "appearance.mode.light": "Light",
  "appearance.mode.dark": "Dark",
  "appearance.mode.hc": "High contrast",
  // The trigger shows a glyph and no words, so this string is the entire control as
  // far as a screen reader is concerned. It names the control AND its current value,
  // which is what the visible chip used to do between its border and its check mark.
  "appearance.trigger": "Appearance: {mode}",

  // The account menu (task 032). The trigger is two decorative letters, so the same
  // rule applies: its accessible name is the only thing announcing what it opens.
  "account.trigger": "Account menu for {email}",
  "account.menuLabel": "Account",
  "account.signedInAs": "Signed in as",

  "nav.label": "Primary",
  "nav.questions": "Questions",
  "nav.forms": "Forms",
  "nav.responses": "Responses",
  "nav.webhooks": "Webhooks",
  "nav.settings": "Settings",

  "signIn.title": "Sign in to QCMS",
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
  "settings.passwordIntro": "Changing your password signs out every other session on every device.",
  "settings.currentPassword": "Current password",
  "settings.newPassword": "New password",
  "settings.passwordChanged": "Your password was changed and other sessions were signed out.",
  "settings.twoFactorTitle": "Two-factor authentication",
  "settings.twoFactorOn": "Two-factor authentication is on for this account.",
  "settings.twoFactorOff": "Two-factor authentication is not set up for this account.",

  // The area screens tasks 033-035 replace. Each says what it will hold so the
  // shell is navigable and reviewable now, and so an empty page never reads as a
  // bug during the screenshot gate. (Questions is no longer among them: task 032
  // replaced its placeholder with the real library.)
  "area.forms.title": "Forms",
  "area.forms.pending": "The form builder and condition editor land in task 033.",
  "area.responses.title": "Responses",
  "area.responses.pending": "Response browsing, export, and erasure land in task 035.",
  "area.webhooks.title": "Webhooks",
  "area.webhooks.pending": "Webhook configuration and delivery history land in task 035.",

  // ---------------------------------------------------------------------------
  // The question library (task 032).
  //
  // Two wording rules run through this whole block and are worth stating once.
  //
  // 1. **Confirmations teach the rule, not the click.** "Are you sure?" tells an
  //    author nothing; "publishing freezes this version and makes it pinnable"
  //    tells them what the system will now guarantee. Every lifecycle dialog and
  //    every error sentence here names the governing rule, because these rules
  //    (immutability, no id reuse, deprecate-not-delete) are the product's
  //    identity and the UI is where they are taught (ADR-02).
  // 2. **No sentence blames the author for a rule they were never shown.** An
  //    error says what the engine decided and what to do next, in that order.
  // ---------------------------------------------------------------------------
  "questions.title": "Questions",
  "questions.intro": "The governed library. Every version is published, never overwritten.",
  "questions.new": "New question",
  "questions.backToList": "Back to questions",

  "questions.filter.legend": "Filter the library",
  "questions.filter.search": "Search",
  "questions.filter.searchHint": "Matches the slug and the label text.",
  "questions.filter.status": "Status",
  "questions.filter.statusAll": "Any status",
  "questions.filter.type": "Type",
  "questions.filter.typeAll": "Any type",
  "questions.filter.apply": "Apply",
  "questions.filter.clear": "Clear filters",

  "questions.table.label": "Question library",
  "questions.table.hint": "Open a question with Enter, or by clicking its row.",
  "questions.column.id": "Question ID",
  "questions.column.label": "Label",
  "questions.column.type": "Type",
  "questions.column.typeUnknown": "Unknown",
  "questions.column.version": "Latest",
  "questions.column.status": "Status",
  "questions.column.created": "Created",

  "questions.empty.title": "Nothing in the library yet",
  "questions.empty.body":
    "Create the first question. To explore with the sample insurance library instead, run pnpm qcms:seed-fixtures against a development database.",
  "questions.empty.filtered": "No question matches this search.",
  "questions.count": "{count} of {total} questions.",

  "questions.status.draft": "Draft",
  "questions.status.published": "Published",
  "questions.status.deprecated": "Deprecated",

  "questions.type.shortText": "Short text",
  "questions.type.longText": "Long text",
  "questions.type.number": "Number",
  "questions.type.date": "Date",
  "questions.type.boolean": "Yes or no",
  "questions.type.singleChoice": "Single choice",
  "questions.type.multiChoice": "Multiple choice",

  "questions.create.title": "New question",
  "questions.create.slug": "Slug",
  "questions.create.slugHint":
    "Lower-case words separated by hyphens, for example at-fault-accident.",
  "questions.create.id": "Question ID",
  "questions.create.idPending": "Enter a slug to see the ID this question will carry.",
  "questions.create.idNote":
    "Generated from the slug and permanent from the moment you create it. An ID is never reused for a different meaning, so a question with the wrong ID is replaced by a new one, never renamed (R6).",
  "questions.create.type": "Type",
  "questions.create.typeNote":
    "Locked once the question exists. A different type is a different answer shape, so changing it means creating a new question rather than editing this one (R6).",
  "questions.create.submit": "Create draft",

  "questions.editor.heading": "Version {version}",
  "questions.editor.label": "Label",
  "questions.editor.help": "Help text",
  "questions.editor.helpHint": "Optional. Shown under the control.",
  "questions.editor.required": "An answer is required",
  "questions.editor.typeLocked": "Type is locked to {type}.",
  "questions.editor.save": "Save draft",
  "questions.editor.saved": "Draft saved.",
  "questions.editor.constraints": "Constraints",
  "questions.editor.noConstraints": "This type has no constraints to set.",
  "questions.editor.problems":
    "The engine rejected this draft. The details are on the fields below.",
  "questions.editor.frozen":
    "This version is frozen: its content can never change again. Create a new version to make an edit.",

  "questions.constraint.minLength": "Shortest answer",
  "questions.constraint.maxLength": "Longest answer",
  "questions.constraint.pattern": "Pattern",
  "questions.constraint.patternHint":
    "A regular expression the answer must match. The engine accepts a safe subset and has the final say on save.",
  "questions.constraint.patternSample": "Sample answer to try",
  "questions.constraint.patternMatch": "The sample matches this pattern.",
  "questions.constraint.patternNoMatch": "The sample does not match this pattern.",
  "questions.constraint.patternUnreadable": "This is not a readable expression yet.",
  "questions.constraint.min": "Smallest value",
  "questions.constraint.max": "Largest value",
  "questions.constraint.integer": "Whole numbers only",
  "questions.constraint.earliest": "Earliest date",
  "questions.constraint.latest": "Latest date",
  "questions.constraint.minSelected": "Fewest selections",
  "questions.constraint.maxSelected": "Most selections",

  "questions.options.legend": "Options",
  "questions.options.note":
    "An option ID is generated once, when the option is added, and never changes again. Relabelling and reordering leave it alone, which is what keeps a rule matching the same answer years later (R6).",
  "questions.options.idColumn": "Option ID",
  "questions.options.label": "Label for option {position}",
  "questions.options.moveUp": "Move option {position} up",
  "questions.options.moveDown": "Move option {position} down",
  "questions.options.remove": "Remove option {position}",
  "questions.options.add": "Add option",
  "questions.options.newLabel": "New option label",

  "questions.preview.title": "Preview",
  "questions.preview.note":
    "Rendered by the same engine that serves a respondent, so this is exactly what they will see. Nothing typed here is saved.",
  "questions.preview.unavailable": "This version could not be rendered. {message}",

  "questions.detail.versions": "Versions",
  "questions.detail.version": "Version {version}",
  "questions.detail.selected": "Showing",
  "questions.detail.publishedAt": "Published {date}",
  "questions.detail.unpublished": "Never published",
  "questions.detail.slug": "Slug",
  "questions.detail.type": "Type",
  "questions.detail.created": "Created",
  "questions.detail.deprecatedNote":
    "This version is deprecated: no new form can pin it. Forms that already pin it keep working exactly as they are, and no answer already collected changes.",

  "questions.action.publish": "Publish version {version}",
  "questions.action.newVersion": "New version",
  "questions.action.deprecate": "Deprecate version {version}",
  "questions.action.cancel": "Cancel",
  "questions.confirm.publishTitle": "Publish version {version}?",
  "questions.confirm.publishBody":
    "Publishing freezes this version's content for good and makes it pinnable by a form. To change anything afterwards you create version {next}, which leaves every form pinned to this one untouched.",
  "questions.confirm.publishConfirm": "Publish",
  "questions.confirm.newVersionTitle": "Create version {next}?",
  "questions.confirm.newVersionBody":
    "Version {next} starts as a draft copied from version {version}. Published versions never change, so forms pinned to them are unaffected until someone pins the new one.",
  "questions.confirm.newVersionConfirm": "Create draft",
  "questions.confirm.deprecateTitle": "Deprecate version {version}?",
  "questions.confirm.deprecateBody":
    "Deprecating blocks new pins. Forms already pinned to this version keep working exactly as they are, no collected answer changes, and nothing is deleted: a question is retired, never removed (R6).",
  "questions.confirm.deprecateConfirm": "Deprecate",

  "questions.error.invalidId": "That is not a valid question ID.",
  "questions.error.invalidDefinition":
    "The engine rejected this draft. The details are on the fields below.",
  "questions.error.idMismatch": "This draft names a different question than the one being edited.",
  "questions.error.idReused":
    "That ID has been used before. IDs are never reused for a different meaning, so choose a different slug (R6).",
  "questions.error.slugTaken": "Another question already uses that slug.",
  "questions.error.notFound": "That question does not exist.",
  "questions.error.versionNotFound": "That version does not exist.",
  "questions.error.versionImmutable":
    "Published and deprecated versions are frozen. Create a new version to change the content.",
  "questions.error.invalidVersionState": "That action does not apply to this version's status.",
  "questions.error.unauthorized": "Your session is no longer valid. Sign in again.",
  "questions.error.rateLimited": "Too many requests just now. Try again shortly.",
  "questions.error.internal": "Something went wrong on the server. Try again.",
  "questions.error.unknown": "The request failed ({code}).",
  "questions.error.listFailed": "The library could not be loaded. {message}",
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
