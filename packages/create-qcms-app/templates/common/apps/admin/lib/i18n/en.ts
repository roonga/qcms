/** Auth refusals must stay opaque across every screen to prevent enumeration. Recovery copy must never promise redisplay: only regeneration can produce another set. */

export const messages = {
  /** Name the rail subject without repeating the navigation role a screen reader already announces. */
  "rail.sections": "{subject} sections",

  "rail.filters": "Filters",
  "rail.filters.activeOne": "1 active",
  "rail.filters.active": "{count} active",
  "rail.filters.apply": "Apply",
  "rail.filters.clear": "Clear filters",

  /** Include active filter count when the hidden rail would otherwise conceal it. */
  "rail.hide": "Hide sidebar",
  "rail.show": "Show sidebar",
  "rail.show.filtered": "Show sidebar · {filters}",
  "rail.show.oneFilter": "1 filter",
  "rail.show.filters": "{count} filters",

  "app.title": "QCMS",
  "app.description": "Author questionnaires, publish forms, and review responses.",

  /** Put the page name first because tab strips truncate the right; keep the product name for bookmarks and history. */
  "app.pageTitle": "{page} - QCMS",
  /** Use route identity for tab titles to avoid a second upstream read solely for metadata. */
  "title.formSection": "{section}: {formId}",

  /** The admin requires JavaScript; name enabling it and reloading as the actionable remedy. */
  "requiresJs.title": "JavaScript is required",
  "requiresJs.body":
    "QCMS needs JavaScript to run. Turn on JavaScript in your browser settings, then reload this page.",

  "action.skipToContent": "Skip to content",
  "action.signIn": "Sign in",
  "action.signOut": "Sign out",
  "action.verify": "Verify",
  "action.savePassword": "Change password",
  "action.changePassword": "Change password",

  /** Keep per-entity full sentence templates so translation can inflect nouns and accessible names identify both entity and value. */
  "ids.copy.session": "Copy session id {id}",
  "ids.copy.link": "Copy link id {id}",
  "ids.copy.webhook": "Copy webhook id {id}",
  "ids.copy.form": "Copy form id {id}",
  "ids.copy.question": "Copy question id {id}",

  "ids.copy.group": "Copy group id {id}",
  "ids.copied.session": "Copied session id {id}",
  "ids.copied.link": "Copied link id {id}",
  "ids.copied.webhook": "Copied webhook id {id}",
  "ids.copied.form": "Copied form id {id}",
  "ids.copied.question": "Copied question id {id}",
  "ids.copied.group": "Copied group id {id}",

  "appearance.title": "Appearance",
  "appearance.theme.legend": "Theme",
  "appearance.polarity.auto": "Auto",
  "appearance.polarity.light": "Light",
  "appearance.polarity.dark": "Dark",
  /** The icon-only trigger must announce both appearance axes because no visible text states them. */
  "appearance.trigger": "Appearance: {state}",
  "appearance.state.auto": "Auto, {resolved} now",
  "appearance.state.withContrast": "{polarity}, high contrast",

  "appearance.hint.following": "Following your system: {resolved} now.",
  "appearance.hint.fixed": "Fixed.",
  "appearance.contrast.legend": "High contrast",
  "appearance.contrast.on": "On",
  "appearance.contrast.off": "Off",

  "appearance.contrast.note": "High contrast never follows your system.",
  "appearance.preview.light": "Light",
  "appearance.preview.dark": "Dark",
  "appearance.preview.lightHc": "Light, high contrast",
  "appearance.preview.darkHc": "Dark, high contrast",

  /** Environment names are API data, never a closed catalog vocabulary. */
  "environment.legend": "Environment",
  "environment.trigger": "Environment: {environment}",
  /** Announce switches only; first render already names the environment. */
  "environment.nowWorking": "Now working in {environment}.",
  /** Destructive confirmations must restate the environment because targeting the wrong one cannot be undone. */
  "environment.inThis": "In {environment}.",
  /** Unknown discovery must never look like confirmed prod. */
  "environment.unknown": "Environment unknown",
  /** Refuse stale page-bound environments instead of retargeting an action after another tab switches. */
  "environment.switched":
    "This tab was showing {shown}; you have since switched to {current}. Nothing was changed. Reload to continue.",
  "environment.unconfirmed":
    "QCMS could not confirm which environment this tab is showing, so nothing was changed. Reload to try again.",

  /** Include the visible initials in the accessible name for speech input, with email to distinguish the acting account. */
  "account.trigger": "{initials}, account menu for {email}",
  "account.menuLabel": "Account",
  "account.signedInAs": "Signed in as",

  "nav.label": "Primary",
  "nav.questions": "Questions",
  "nav.forms": "Forms",
  "nav.workspaces": "Workspaces",
  "nav.settings": "Settings",

  "nav.operations": "Operations",

  "shell.mode.operations.name": "Operations",
  "shell.mode.operations.exit": "Exit Operations",
  "shell.mode.operations.announce": "Operations. The authoring menus are not shown here.",
  "shell.mode.workspaces.name": "Workspaces",
  "shell.mode.workspaces.exit": "Exit Workspaces",
  "shell.mode.workspaces.announce": "Workspaces. The authoring menus are not shown here.",

  /** Do not resolve refused IDs to titles: that would disclose their existence. */
  "shell.denied.title": "You do not have access to this area",
  "shell.denied.body":
    "Your access may have changed, or the address may belong to an area you were never " +
    "granted. Nothing about it is shown here.",
  "shell.denied.recover": "Go to an area you can use",
  "shell.denied.myAccess": "See what you can access",

  "operations.intro": "The forms you can operate, and the installation's delivery queues.",

  /** Missing grants and missing data must remain indistinguishable in table cells. */
  "operations.count.one": "1 form",
  "operations.count.other": "{count} forms",
  "operations.table": "Forms you can operate",
  "operations.column.form": "Form",
  "operations.column.workspace": "Workspace",
  "operations.column.released": "Released",
  "operations.column.intake": "Intake",
  "operations.column.lastRelease": "Last release",
  "operations.column.submitted": "Submitted",
  "operations.column.inProgress": "In progress",

  "operations.intake.open": "Open",
  "operations.intake.closed": "Closed",
  "operations.intake.unreleased": "No release",
  "operations.release.none": "No release",
  "operations.loading": "Loading the forms you can operate.",

  "operations.environmentUnknown":
    "QCMS could not read the environment list, so it cannot say which environment to show " +
    "these forms for. Reload to try again.",
  "operations.loadFailed": "The forms could not be loaded: {message}",
  "operations.empty.title": "No forms to operate here",
  "operations.empty.body":
    "You hold no operational grant on a form in this environment. Ask an owner of the " +
    "workspace you need to add you to one of its access groups.",
  "operations.empty.filtered": "No forms match these filters.",
  "operations.filter.search": "Search",
  "operations.filter.searchHint": "Matches a form's name or identifier.",
  "operations.filter.workspace": "Workspace",
  "operations.filter.workspaceAll": "Any workspace",
  "operations.filter.intake": "Intake",
  "operations.filter.intakeAll": "Any intake",
  "operations.filter.sort": "Sort",
  "operations.filter.sort.slug-asc": "Identifier A to Z",
  "operations.filter.sort.slug-desc": "Identifier Z to A",
  "operations.filter.sort.released-desc": "Released, newest first",
  "operations.filter.sort.released-asc": "Released, oldest first",
  "operations.filter.sort.submitted-desc": "Submitted, most first",
  "operations.filter.sort.submitted-asc": "Submitted, fewest first",
  "operations.pagination": "Pages",
  "operations.page.next": "Next page",
  "operations.page.first": "First page",

  "operations.queue.deliveryFailures": "Delivery failures",
  "operations.queue.erasureLog": "Erasure log",

  "access.title": "My access",
  "access.intro": "What this account holds, and who to ask for more.",
  "access.none":
    "You hold no form, question, response or workspace grant yet. Ask an owner of the " +
    "workspace you need to add you to one of its access groups.",

  "signIn.title": "Sign in to QCMS",
  "signIn.email": "Email",
  "signIn.password": "Password",
  /** Wrong password, unknown email, wrong TOTP and wrong recovery code must share one failure message. */
  "signIn.error": "Those details did not match. Please try again.",
  "signIn.throttled": "Too many attempts. Please try again later.",
  "signIn.expired": "Your session expired. Please sign in again.",

  /** Explain why a provisioning password must change without exposing operator commands or variable names to the administrator. */
  "forcedPassword.title": "Choose your own password",
  "forcedPassword.intro":
    "The password this account was created with was set for you, so it is temporary. Choose one only you know before you continue.",
  "forcedPassword.current": "Temporary password",
  "forcedPassword.new": "New password",
  "forcedPassword.confirm": "Confirm new password",
  /** Specific mismatch feedback discloses only submitted values, not account state. */
  "forcedPassword.mismatch": "The two new passwords did not match. Please type them again.",

  "enroll.title": "Set up two-factor authentication",
  "enroll.intro":
    "Scan this code with your authenticator app, then enter the six-digit code it shows.",
  "enroll.manualLabel": "Setup key (use this if you cannot scan the code)",
  "enroll.codeLabel": "Six-digit code from your app",

  "recovery.title": "Save your recovery codes",
  "recovery.intro":
    "Each code signs you in once if you lose your authenticator. This is the only time they are shown.",
  "recovery.listLabel": "Recovery codes",
  /** Both absent and denied clipboard access require the same manual-copy remedy; do not expose browser jargon. */
  "recovery.copy": "Copy codes",
  "recovery.copied": "Codes copied.",
  "recovery.copyFailed": "Could not copy automatically. Select the codes above and copy manually.",
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
  /** Breach-corpus feedback may be specific because it says nothing about the account. */
  "settings.passwordCompromised":
    "That new password appears in public breach data, so it was not accepted. Choose a different password.",
  "settings.twoFactorTitle": "Two-factor authentication",
  "settings.twoFactorOn": "Two-factor authentication is on for this account.",
  "settings.twoFactorOff": "Two-factor authentication is not set up for this account.",
  "settings.recoveryCodesTitle": "Recovery codes",
  "settings.recoveryCodesIntro":
    "Your saved codes cannot be shown again. If you have lost them, generate a new set: the codes you have now will stop working.",
  "settings.recoveryCodesPassword": "Your password",
  "settings.recoveryCodesAction": "Generate new recovery codes",

  /** Confirmations teach immutable versions and permanent IDs; refusal copy names the rule and remedy without blaming the author. */
  "questions.title": "Questions",
  "questions.intro": "The governed library. Every version is published, never overwritten.",
  "questions.new": "New question",

  "questions.filter.search": "Search",
  "questions.filter.searchHint": "Matches the slug and the label text.",
  "questions.filter.status": "Status",
  "questions.filter.statusAll": "Any status",
  "questions.filter.type": "Type",
  "questions.filter.typeAll": "Any type",
  "questions.filter.clear": "Clear filters",

  "questions.table.label": "Question library",
  "questions.table.hint": "Open a question from the link in its ID column.",
  "questions.open": "Open question {questionId}",
  "questions.column.id": "Question ID",
  "questions.column.label": "Label",
  "questions.column.type": "Type",
  "questions.column.typeUnknown": "Unknown",
  "questions.column.version": "Latest",
  "questions.column.status": "Status",
  "questions.column.created": "Created",

  "questions.empty.title": "Nothing in the library yet",
  /** Point development seeding at the composed database; a successful seed of another database would leave this screen unchanged. */
  "questions.empty.body":
    "Create the first question to start building the library.",
  "questions.empty.filtered": "No question matches this search.",

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

  "questions.create.manualModel":
    "This editor does not save automatically. Leaving this page discards what you have written.",

  "questions.editor.label": "Label",
  "questions.editor.help": "Help text",
  "questions.editor.helpHint": "Optional. Shown under the control.",
  "questions.editor.required": "An answer is required",
  "questions.editor.save": "Save draft",
  "questions.editor.manualModel":
    "This editor does not save automatically. Leaving this page discards unsaved changes.",
  "questions.editor.saved": "Draft saved.",
  "questions.editor.constraints": "Constraints",
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
  /** HTML pattern compilation has stricter syntax; offer equivalent normalized text before persistence. */
  "questions.constraint.patternVSuggestion":
    "A browser reads the pattern attribute more strictly than this and would ignore this expression. The same rule written as {suggestion} works everywhere.",
  "questions.constraint.patternVUnsafe":
    "A browser reads the pattern attribute more strictly than this and would ignore this expression. Answers are still checked by the engine, but the in-page hint is lost.",
  "questions.constraint.min": "Smallest value",
  "questions.constraint.max": "Largest value",
  "questions.constraint.integer": "Whole numbers only",
  "questions.constraint.earliest": "Earliest date",
  "questions.constraint.latest": "Latest date",
  "questions.constraint.minSelected": "Fewest selections",
  "questions.constraint.maxSelected": "Most selections",

  /** Default constraint messages and boolean labels mirror respondent copy across the BFF boundary. Change both copies together or the placeholder promises wording respondents never see. */
  "questions.editor.messages": "Validation messages",
  "questions.message.note":
    "Optional. Leave a field blank and the respondent sees the default shown inside it. A field appears only for a constraint this question carries, so clearing the constraint clears its message too.",

  "questions.message.label.required": "Message when no answer is given",
  "questions.message.label.minLength": "Message when the answer is too short",
  "questions.message.label.maxLength": "Message when the answer is too long",
  "questions.message.label.pattern": "Message when the answer does not match the pattern",
  "questions.message.label.min": "Message when the value is too small",
  "questions.message.label.max": "Message when the value is too large",
  "questions.message.label.integer": "Message when the answer is not a whole number",
  "questions.message.label.minSelected": "Message when too few options are selected",
  "questions.message.label.maxSelected": "Message when too many options are selected",

  "questions.message.label.date.min": "Message when the date is too early",
  "questions.message.label.date.max": "Message when the date is too late",

  "questions.message.default.required": "This question needs an answer.",
  "questions.message.default.minLength": "Answer must be at least {n} characters",
  "questions.message.default.maxLength": "Answer must be at most {n} characters",
  "questions.message.default.pattern": "Answer does not match the required format",
  "questions.message.default.min": "Answer must be at least {bound}",
  "questions.message.default.max": "Answer must be at most {bound}",
  "questions.message.default.integer": "Answer must be a whole number",
  "questions.message.default.minSelected": "Select at least {n} option(s)",
  "questions.message.default.maxSelected": "Select at most {n} option(s)",

  "questions.editor.booleanLabels": "Yes and no labels",
  "questions.booleanLabel.note":
    "Optional. Leave a field blank and the respondent sees the default shown inside it. Each label falls back on its own, so renaming one leaves the other alone. The stored answer is still true or false, so no rule, export or report changes meaning.",
  "questions.booleanLabel.yes": "Label for the affirmative choice",
  "questions.booleanLabel.no": "Label for the negative choice",
  "questions.booleanLabel.defaultYes": "Yes",
  "questions.booleanLabel.defaultNo": "No",

  /** Rail labels must reuse their panel names; digests are catalog phrases so translations can reorder bounds. */
  "questions.panel.content": "Content",
  "questions.panel.contentRequired": "Required",
  "questions.panel.contentOptional": "Optional",
  "questions.panel.optionsDigestOne": "{count} option",
  "questions.panel.optionsDigest": "{count} options",
  "questions.panel.messagesDigestOne": "{count} message",
  "questions.panel.messagesDigest": "{count} messages",
  "questions.panel.constraintsNone": "None set",
  "questions.panel.constraintMin": "min {value}",
  "questions.panel.constraintMax": "max {value}",

  "questions.panel.constraintFrom": "from {value}",
  "questions.panel.constraintTo": "to {value}",
  "questions.panel.constraintPattern": "pattern",
  "questions.panel.constraintInteger": "whole numbers",

  "questions.panel.previewDigest": "As a respondent sees it",

  "questions.options.legend": "Options",
  "questions.options.note":
    "An option ID is generated once, when the option is first named, and never changes again. Relabelling and reordering leave it alone, which is what keeps a rule matching the same answer years later (R6).",
  "questions.options.headLabel": "Label",
  "questions.options.headId": "ID",
  "questions.options.idPending": "Pending",
  "questions.options.idPendingTitle":
    "This row has no ID yet. One is generated from the label, once the row is named.",

  "questions.options.label": "Option {position} label",
  "questions.options.rowFallback": "option {position}",
  "questions.options.reorder": "Reorder {row}",
  "questions.options.rowActions": "{row} row actions",
  "questions.options.insertAbove": "Insert option above {row}",
  "questions.options.insertBelow": "Insert option below {row}",
  /** Name the row in the non-drag reorder alternative so repeated controls remain distinguishable. */
  "questions.options.moveUp": "Move {row} up",
  "questions.options.moveDown": "Move {row} down",
  "questions.options.remove": "Remove option {row}",
  "questions.options.add": "Add option",
  "questions.options.moved": "{row} moved to position {position} of {total}.",
  "questions.options.errorFor": "Option {position}: {message}",

  "questions.preview.title": "Preview",
  "questions.preview.note":
    "Rendered by the same engine that serves a respondent, so this is exactly what they will see. Nothing typed here is saved.",
  "questions.preview.unavailable": "This version could not be rendered. {message}",
  /** Preview compiles stored content and cannot show unsaved edits. */
  "questions.preview.stale":
    "This preview is the version that was last saved. Save the draft to see your latest changes here.",

  /** Theme names identify shipped palettes; preserve identity while permitting transliteration. Mode names are ordinary translated prose. */
  "preview.island.theme": "Preview theme",
  "preview.island.theme.slate": "Slate",
  "preview.island.theme.harbor": "Harbor",
  "preview.island.theme.sand": "Sand",
  "preview.island.theme.plum": "Plum",
  "preview.island.mode": "Preview mode",
  "preview.island.mode.light": "Light",
  "preview.island.mode.dark": "Dark",
  "preview.island.mode.hc": "High contrast",

  "questions.detail.versions": "Versions",
  "questions.detail.version": "Version {version}",
  "questions.detail.publishedAt": "Published {date}",
  "questions.detail.unpublished": "Never published",
  "questions.detail.slug": "Slug",
  "questions.detail.type": "Type",
  "questions.detail.created": "Created",

  "questions.detail.typeLocked": "{type} (locked)",
  "questions.detail.deprecatedNote":
    "This version is deprecated: no new form can pin it. Forms that already pin it keep working exactly as they are, and no answer already collected changes.",

  "questions.rail.digestOne": "{count} version, v{version} published",
  "questions.rail.digest": "{count} versions, v{version} published",
  "questions.rail.digestNoneOne": "{count} version, none published",
  "questions.rail.digestNone": "{count} versions, none published",

  "questions.rail.panels": "Editor panels",
  "questions.rail.issuesOne": "1 issue",
  "questions.rail.issues": "{count} issues",

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

  /** Copy must teach manual frozen pins, forward-only targets, set equality versus containment, and deployment-dependent challenges; none may imply protection or upgrades the API does not provide. */
  "forms.title": "Forms",
  "forms.intro": "Compose published questions into steps, and branch between them with rules.",
  "forms.new": "New form",

  "forms.table.label": "Form library",
  "forms.table.hint": "Open a form from the link in its Slug column.",
  "forms.open": "Open form {slug}",
  "forms.column.formId": "Form ID",
  "forms.column.slug": "Slug",
  "forms.column.locale": "Locale",
  "forms.column.status": "Status",
  "forms.column.draft": "Draft",
  "forms.column.version": "Published",
  "forms.status.open": "Open",
  "forms.status.closed": "Closed",
  "forms.draft.present": "Unpublished draft",
  "forms.draft.none": "No draft",
  "forms.version.none": "Never published",
  "forms.version.value": "v{version}",
  "forms.version.valueAt": "v{version} on {date}",

  "forms.filter.search": "Search",
  "forms.filter.searchHint": "Matches the slug and the form title.",
  "forms.filter.status": "Status",
  "forms.filter.statusAll": "Any status",
  "forms.filter.sort": "Sort by",
  "forms.filter.sort.slug-asc": "Slug (A to Z)",
  "forms.filter.sort.slug-desc": "Slug (Z to A)",
  "forms.filter.sort.published-desc": "Newest published",
  "forms.filter.sort.published-asc": "Oldest published",
  "forms.filter.clear": "Clear filters",
  /** Keep counted phrases in catalog plural forms; do not append an English s in code. */
  "forms.count.one": "{count} form.",
  "forms.count.other": "{count} forms.",

  "forms.empty.title": "No forms yet",
  "forms.empty.body":
    "Create the first form, then pin published questions into its steps. A question has to be published before a form can pin it.",
  "forms.empty.filtered": "No form matches this search.",

  "forms.create.title": "New form",
  "forms.create.slug": "Slug",
  "forms.create.slugHint": "Lower-case words separated by hyphens, for example vehicle-insurance.",
  "forms.create.id": "Form ID",
  "forms.create.idPending": "Enter a slug to see the ID this form will carry.",
  "forms.create.idNote":
    "Generated from the slug and permanent from the moment you create it. An ID is never reused for a different meaning, so a form with the wrong ID is replaced by a new one, never renamed (R6).",
  "forms.create.formTitle": "Title",
  "forms.create.formTitleHint": "What a respondent sees at the top of the questionnaire.",
  "forms.create.locale": "Default locale",
  "forms.create.localeHint": "The locale every step and question must have text for.",
  "forms.create.submit": "Create form",
  "forms.create.submitting": "Creating the form...",

  "forms.builder.formId": "Form ID",
  "forms.builder.status": "Status",
  "forms.builder.draftSource.open": "Editing the saved draft.",
  "forms.builder.draftSource.seeded":
    "Started from the newest published version. Nothing is stored until the first save.",
  "forms.builder.draftSource.none": "Nothing has been drafted or published for this form yet.",
  "forms.builder.formTitle": "Form title",
  "forms.builder.formTitleHint": "Shown to a respondent. Saved with the draft.",
  "forms.builder.seeded":
    "This draft was started from the newest published version and has not been saved yet. Your first change stores it.",
  "forms.builder.concurrent":
    "Autosave replaces the stored draft outright: if another author has this form open, whichever of you saves last wins and the other's change is gone. There is no locking at launch, so coordinate before editing the same form.",
  "forms.save.flash": "Saved",
  "forms.builder.concurrentDismiss": "Got it",
  "forms.builder.saveFailed": "This draft could not be saved. {message}",
  "forms.builder.closed":
    "This form is closed to new responses. Editing the draft is still allowed; publishing is what makes a change live.",

  "forms.save.model": "This draft saves automatically as you edit.",
  "forms.save.modelLabel": "How does this screen save?",
  "forms.save.idle": "Not saved yet",
  "forms.save.saving": "Saving...",
  "forms.save.saved": "Last saved {time}",
  "forms.save.failed": "The last save failed.",
  "forms.save.pausedNoSteps":
    "Autosave is paused: a form needs at least one step before it can be stored.",
  "forms.save.pausedEmptyStep":
    "Autosave is paused: every step needs at least one question before the draft can be stored.",
  /** An empty new group is temporarily unparseable, not merely inconsistent. */
  "forms.save.pausedEmptyGroup":
    "Autosave is paused: every repeating group needs at least one question before the draft can be stored.",
  "forms.save.pausedNoTarget":
    "Autosave is paused: every rule needs at least one question or step to show before the draft can be stored.",

  "forms.validation.title": "Validation",
  "forms.validation.none": "No issues. Everything here would pass a publish.",
  "forms.validation.countOne": "1 issue would block a publish.",
  "forms.validation.count": "{count} issues would block a publish.",
  "forms.validation.checking": "Checking the draft...",
  /** A failed check must not fall through to an all-clear. */
  "forms.validation.unchecked":
    "The draft could not be checked, so this is not a current count of what would block a publish.",
  /** Unchecked is distinct from failed and from an empty successful verdict. */
  "forms.validation.notChecked":
    "This draft has not been checked yet. The check runs on your first change, and again when you publish.",

  "forms.steps.add": "Add step",
  "forms.steps.newTitle": "New step title",
  "forms.steps.addDone": "Add",
  "forms.steps.select": "Open step {title}",
  "forms.steps.menu": "Actions for step {title}",
  "forms.steps.rename": "Rename",
  "forms.steps.renameLabel": "Title for step {title}",
  "forms.steps.renameDone": "Done",
  "forms.steps.moveUp": "Move up",
  "forms.steps.moveDown": "Move down",
  "forms.steps.remove": "Remove",
  "forms.steps.issuesOne": "1 issue",
  "forms.steps.issues": "{count} issues",
  "forms.steps.untitled": "Untitled step",
  "forms.steps.confirmRemoveTitle": "Remove step {title}?",
  "forms.steps.confirmRemoveBody":
    "The step and its pins go with it. Rules that named the step are left exactly as they are, so a rule pointing at it will be reported as a dangling reference rather than being rewritten for you.",
  "forms.steps.confirmRemove": "Remove step",

  "forms.step.heading": "Step: {title}",
  "forms.step.pins": "Questions in this step",
  "forms.step.empty": "No questions pinned yet.",
  "forms.step.addQuestion": "Add question from library",
  "forms.step.pinNote":
    "A pin names one frozen version. Publishing a newer version of a question changes nothing here until someone moves this pin by hand (R7).",
  /** Accessible names must contain the painted version label for speech input and identify the pin among repeated controls. */
  "forms.step.movePin": "{versionLabel}, move pin for {questionId}",
  "forms.step.movePinTo": "Move to v{version}",
  "forms.step.movePinNone": "No other published version",
  "forms.step.movePinUnknown": "Other versions are not known: the question library did not load",
  "forms.step.removePin": "Remove {questionId}",
  "forms.step.pinUp": "Move {questionId} up",
  "forms.step.pinDown": "Move {questionId} down",
  "forms.step.pinDeprecated": "Deprecated version",
  "forms.step.pinDraft": "Unpublished version",
  "forms.step.pinMissing": "Version not found",
  "forms.step.pinVersion": "v{version}",
  "forms.step.rowActions": "Row actions for {questionId}",
  "forms.step.insertAbove": "Insert a question above {questionId}",
  "forms.step.insertBelow": "Insert a question below {questionId}",
  "forms.step.pinMoved": "{questionId} moved to position {position} of {total}",
  "forms.step.pinRemoved": "{questionId} removed from this step",
  "forms.step.emptyBody": "Pin a question from the library and it will appear here.",
  "forms.step.column.reorder": "Row actions",
  "forms.step.column.question": "Question",
  "forms.step.column.type": "Type",
  "forms.step.column.version": "Version",
  "forms.step.column.issues": "Issues",
  "forms.step.noIssues": "None",
  /** No verdict is distinct from a successful empty verdict. */
  "forms.step.issuesUnchecked": "Not checked",
  "forms.step.labelMissing": "No label in the library",
  "forms.step.labelUnknown": "Label not known",

  /** One repeating-group primitive has three layouts; wording must not imply separate data models. */
  "forms.group.add": "Add repeating group",
  "forms.group.newName": "New group name",
  "forms.group.addDone": "Add",
  "forms.group.select": "Open repeating group {label}",
  "forms.group.menu": "Actions for repeating group {label}",
  "forms.group.remove": "Remove",
  "forms.group.moveUp": "Move up",
  "forms.group.moveDown": "Move down",
  "forms.group.confirmRemoveTitle": "Remove repeating group {label}?",
  "forms.group.confirmRemoveBody":
    "The group and the questions pinned inside it go with it. Rules that read the group are left exactly as they are, so a rule pointing at it will be reported as a dangling reference rather than being rewritten for you.",
  "forms.group.confirmRemove": "Remove group",
  "forms.group.heading": "Repeating group: {label}",
  "forms.group.note":
    "The questions in a group are answered once per instance. The questions themselves do not change: the same library question can be repeated in this form and asked once in another.",
  "forms.group.name": "Group name",
  "forms.group.nameHint":
    "What this set of questions is, in the plural: Passengers, Income sources.",
  "forms.group.idLabel": "Group ID",
  "forms.group.members": "Questions in this group",
  "forms.group.membersEmpty": "No questions in this group yet.",
  "forms.group.membersEmptyBody":
    "A group has to hold at least one question. Pin one from the library and it will appear here.",
  "forms.group.addQuestion": "Add question from library",
  "forms.group.memberCountOne": "1 question",
  "forms.group.memberCount": "{count} questions",

  "forms.group.countLegend": "How many instances",
  "forms.group.count.fixed": "Always the same number",
  "forms.group.count.fixedHint":
    "Every respondent answers this group exactly this many times. The number is its own limit, so there is no maximum to set.",
  "forms.group.count.fromAnswer": "From an earlier answer",
  "forms.group.count.fromAnswerHint":
    "A number question earlier in the form decides how many instances appear. It has to come before this group and must not itself be inside a group.",
  "forms.group.count.open": "The respondent adds and removes",
  "forms.group.count.openHint":
    "The respondent presses Add to create an instance and Remove to drop one.",
  "forms.group.fixedCount": "Number of instances",
  "forms.group.countQuestion": "Count question",
  "forms.group.countQuestionNone":
    "No number question is pinned before this group yet. Pin one earlier in the form and it will be offered here.",
  "forms.group.min": "Minimum instances",
  "forms.group.max": "Maximum instances",
  /** A bounded group maximum is security-relevant: no installation-wide ceiling bounds respondent-created instances. */
  "forms.group.maxRequired":
    "Required. This is the only limit on how many instances a respondent can create.",
  "forms.group.maxMissing": "Set a maximum. Until you do, this form cannot be published.",
  "forms.group.instanceLabel": "Heading for each instance",
  "forms.group.instanceLabelHint":
    "Use {n} where the instance's position should go: Passenger {n}. A heading with no {n} is allowed, which suits a group of one.",
  "forms.group.instanceLabelPreview": "A respondent reads",
  "forms.group.instanceLabelPreviewEmpty": "Nothing yet: type a heading above.",

  "forms.group.presentationLegend": "How the instances are laid out",
  "forms.group.presentation.stacked": "All instances on one page",
  "forms.group.presentation.stackedHint":
    "Each instance is a card, one after another, with Add and Remove beside them.",
  "forms.group.presentation.perInstanceStep": "One page per instance",
  "forms.group.presentation.perInstanceStepHint":
    "The step repeats: the respondent answers one instance, continues, and answers the next.",
  "forms.group.presentation.table": "A table",
  "forms.group.presentation.tableHint":
    "Instances become rows and the group's questions become columns. Only some question types can be a column.",
  "forms.group.issues": "Issues with this group",

  "forms.group.boundary": "Repeating group: {label}",
  "forms.group.boundaryEnd": "End of repeating group {label}",
  "forms.group.boundarySummary": "{members}, {count}",
  "forms.group.open": "Open group settings",
  "forms.group.countSummary.fixed": "always {count}",
  "forms.group.countSummary.fromAnswer": "from {questionId}, {min} to {max}",
  "forms.group.countSummary.open": "respondent adds, {min} to {max}",
  /** Name an unset required maximum instead of showing a range that looks accidentally truncated. */
  "forms.group.countSummary.fromAnswerNoMax": "from {questionId}, no maximum set",
  "forms.group.countSummary.openNoMax": "respondent adds, no maximum set",
  "forms.group.railGroups": "Repeating groups",
  "forms.group.untitled": "Untitled group",

  "forms.picker.title": "Add questions to {title}",
  "forms.picker.description":
    "Choose one or more published versions, then add them together. A deprecated version is listed but cannot be pinned, and a question already in this form cannot be pinned twice.",
  "forms.picker.search": "Search",
  "forms.picker.tableLabel": "Question versions",
  "forms.picker.hint":
    "Each version chosen here becomes a pin frozen at that version. Nothing upgrades it afterwards, and every pin stays changeable in the step's grid.",
  "forms.picker.column.choose": "Choose",
  /** Checkbox and removal names must identify the exact question version among repeated rows. */
  "forms.picker.addNamed": "Add {questionId} version {version}",
  "forms.picker.removeNamed": "Remove {questionId} version {version} from the chosen list",
  "forms.picker.column.questionId": "Question ID",
  "forms.picker.column.label": "Label",
  "forms.picker.column.type": "Type",
  "forms.picker.column.version": "Version",
  "forms.picker.column.state": "State",
  "forms.picker.statePinnable": "Pinnable",
  "forms.picker.stateDeprecated": "Deprecated",
  "forms.picker.statePinned": "Already in this form",
  "forms.picker.stateChosen": "Chosen to add",
  /** Explain the selected sibling version because the hidden checkbox no longer explains itself. */
  "forms.picker.stateOtherVersionChosen": "Version {version} of this question is chosen",

  "forms.picker.chosenHeading": "Chosen ({count})",
  "forms.picker.chosenEmpty": "Nothing chosen yet. Check a version to add it.",
  /** Choose a plural form with substitution; zero has its own disabled-action message. */
  "forms.picker.commitNone": "Add questions to step",
  "forms.picker.commit.one": "Add 1 question to step",
  "forms.picker.commit.other": "Add {count} questions to step",
  "forms.picker.empty": "No published question version matches this search.",
  "forms.picker.loadFailed":
    "The question library could not be loaded, so there is nothing to choose from. Close this dialog and reload the page to try again.",
  "forms.picker.cancel": "Cancel",
  /** Table columns are group members; their type comes from the pinned question and is never edited here. */
  "forms.columns.title": "Columns",
  "forms.columns.description":
    "Each column of the table is one question in this group, and the order below is the order the columns are drawn in. A column's type is the question's own: change it in the question, not here.",
  "forms.columns.tableLabel": "Table columns",
  "forms.columns.column.ordinal": "#",
  "forms.columns.column.label": "Column",
  "forms.columns.column.question": "Question",
  "forms.columns.column.type": "Type",
  "forms.columns.add": "Add column",
  "forms.columns.empty": "No columns yet. Add a question to this group and it becomes a column.",

  "forms.columns.typeNote":
    "A table column holds one of {types}. Long text and multiple choice do not fit a cell, and they are worse again on the phone, where the table becomes one card per row. Present this group as stacked instead: that presentation allows every question type.",
  /** Keep unsupported existing members visible so authors can repair the publish refusal. */
  "forms.columns.refused": "Not allowed as a column",
  "forms.columns.refusedHint":
    "This question's type cannot be a table column, so this form cannot be published while it is one. Remove it from the group, or present the group as stacked.",

  "forms.rules.title": "Rules",
  "forms.rules.add": "Add rule",
  "forms.rules.empty": "No rules yet. A rule shows questions or steps when its condition matches.",

  "forms.rules.lensNote":
    "Lists rules whose conditions read, or whose targets include, questions in this form.",
  "forms.rules.lensCountOne": "1 rule",
  "forms.rules.lensCount": "{count} rules",

  "forms.rules.editAll": "Edit rules",
  "forms.rules.needPin": "Pin a question first: a condition has to read one.",
  "forms.rules.column.rule": "Rule",
  "forms.rules.column.issues": "Issues",
  "forms.rules.edit": "Edit",
  "forms.rules.remove": "Remove",

  "forms.rules.editTitle": "Edit rule {ruleId}",

  "forms.rules.phases": "Rule editing phases",

  "forms.rules.phaseWhen": "1. When",
  "forms.rules.phaseThen": "2. Then show",
  "forms.rules.phaseTest": "3. Test",
  /** Accessible phase-navigation names must contain the visible Back or Next word and state the destination. */
  "forms.rules.phaseBack": "Back",
  "forms.rules.phaseNext": "Next",
  "forms.rules.phaseBackTo": "Back to {phase}",
  "forms.rules.phaseNextTo": "Next, {phase}",
  "forms.rules.save": "Save",
  "forms.rules.cancel": "Cancel",
  "forms.rule.heading": "Rule {ruleId}",
  "forms.rule.when": "When",
  "forms.rule.show": "Show",
  /** Name each combobox by its field so repeated condition controls remain distinguishable. */
  "forms.combobox.toggle": "Show all options for {label}",
  "forms.combobox.noMatch": "No match.",
  "forms.rule.op": "Operator",
  "forms.rule.question": "Question",
  "forms.rule.value": "Value",
  "forms.rule.branchAdd": "Add branch",
  "forms.rule.branchRemove": "Remove branch {position}",
  "forms.rule.branchHeading": "Branch {position}",
  "forms.rule.depthReached": "Nesting is capped at {max} levels, which this condition has reached.",
  "forms.rule.targetsEligible": "Comes after this condition",
  "forms.rule.targetsIneligible": "Comes before this condition",
  "forms.rule.targetsNone":
    "Nothing in this form comes after the questions this condition reads, so the rule has nowhere to point yet.",
  "forms.rule.targetStep": "Step {stepId}",

  "forms.rule.targetsFilter": "Filter targets",
  "forms.rule.targetsFilterHint": "Matches a question id, a step id, or a step's name.",
  "forms.rule.targetsShowing": "Showing {shown} of {total} targets.",
  "forms.rule.targetsNoMatch": "No target matches that filter.",
  /** Never narrow the selected-target summary with the search filter or selected choices become invisible. */
  "forms.rule.targetsSelected": "Selected: {targets}",
  "forms.rule.targetsSelectedNone": "Nothing selected yet. This rule would show nothing.",

  "forms.rule.targetsHelpLabel": "Why these cannot be shown",
  "forms.rule.targetsHelpDetail":
    "A rule can only show something the respondent has not reached yet, so it cannot point at anything at or before the last question its condition reads. Those targets are listed here rather than hidden, and cannot be selected. A whole step appears here when any one of its questions does, because showing a step shows every question in it. A rule that points backwards cannot be published.",
  "forms.rule.backwardWarning":
    "{targets} comes before a question this condition reads. A rule can only show something the respondent has not reached yet, so this rule cannot be published until that target is cleared.",
  "forms.rule.issues": "Issues with this rule",

  /** Scope is derived, not authored; show the instance scope because condition syntax alone does not reveal it. */
  "forms.rule.scopePerInstance": "evaluated per {noun}",
  "forms.rule.scopeNote":
    "This rule shows something inside {group}, so it is evaluated once for each {noun}. A question it reads from the same group reads that {noun}'s own answer.",

  "forms.rule.scopeSpanning":
    "This rule shows things in more than one scope, which it cannot do: one rule is evaluated in one scope. Split it into two rules, one per scope - the condition is the same in both.",

  "forms.rule.group": "Group",
  "forms.rule.instanceCompare": "Comparison",
  /** Distinguish the condition comparison from the group count field so speech input can address each one. */
  "forms.rule.instanceValue": "Instance count",
  "forms.rule.compare.equals": "is exactly",
  "forms.rule.compare.gt": "is more than",
  "forms.rule.compare.gte": "is at least",
  "forms.rule.compare.lt": "is fewer than",
  "forms.rule.compare.lte": "is at most",

  "forms.rule.groupBranch": "For one instance of {group}",
  /** State the non-vacuous empty-group reading where the operator is chosen. */
  "forms.rule.everyInstanceReading":
    "With no instances at all this is false, not true. Negating it therefore matches a response with no instances, which is worth checking if you are writing a warning.",

  "forms.op.answered": "has been answered",
  "forms.op.equals": "equals (the whole answer)",
  "forms.op.notEquals": "does not equal (the whole answer)",
  "forms.op.in": "is one of",
  "forms.op.contains": "includes the option",
  "forms.op.containsAny": "includes any of",
  "forms.op.gt": "is greater than",
  "forms.op.gte": "is at least",
  "forms.op.lt": "is less than",
  "forms.op.lte": "is at most",
  "forms.op.and": "all of",
  "forms.op.or": "any of",
  "forms.op.not": "not",

  "forms.op.anyInstance": "at least one instance of a group matches",
  "forms.op.everyInstance": "every instance of a group matches",
  "forms.op.instanceCount": "how many instances a group has",

  "forms.op.needsGroup": "Add a repeating group to a step before a rule can read one.",

  /** Keep whole sentence frames and placeholders in the catalog so clause order remains translatable. */
  "forms.sentence.frame": "When {condition}, show {targets}",

  "forms.sentence.frameNoTargets": "When {condition}, show nothing",

  "forms.sentence.group": "({condition})",
  "forms.sentence.not": "not ({condition})",
  "forms.sentence.listComma": "{left}, {right}",
  "forms.sentence.listAnd": "{left} and {right}",
  "forms.sentence.listOr": "{left} or {right}",
  /** Malformed empty branches must render an explicit admission rather than disappear into an apparently complete sentence. */
  "forms.sentence.noBranches": "a group with no branches",

  "forms.sentence.emptyValue": "an empty value",

  "forms.sentence.stepTarget": "the step {name}",
  "forms.sentence.op.answered": "{question} is answered",
  "forms.sentence.op.equals": "{question} is exactly {value}",
  "forms.sentence.op.notEquals": "{question} is not exactly {value}",
  "forms.sentence.op.in": "{question} is one of {value}",
  "forms.sentence.op.contains": "{question} includes {value}",
  "forms.sentence.op.containsAny": "{question} includes any of {value}",
  "forms.sentence.op.gt": "{question} is greater than {value}",
  "forms.sentence.op.gte": "{question} is at least {value}",
  "forms.sentence.op.lt": "{question} is less than {value}",
  "forms.sentence.op.lte": "{question} is at most {value}",
  /** Use the authored singular instance template for quantification; group labels name plural sets. */
  "forms.sentence.op.anyInstance": "at least one {noun} where {condition}",
  /** everyInstance is false over an empty group; the sentence must state that non-classical reading. */
  "forms.sentence.op.everyInstance":
    "every {noun} where {condition}, and there is at least one {noun}",
  /** Negating everyInstance is true over an empty group, so warning copy must expose that consequence. */
  "forms.sentence.op.notEveryInstance":
    "not every {noun} is one where {condition}, which includes there being no {noun} at all",

  "forms.sentence.count.equals": "the number of {group} is exactly {value}",
  "forms.sentence.count.gt": "the number of {group} is more than {value}",
  "forms.sentence.count.gte": "the number of {group} is at least {value}",
  "forms.sentence.count.lt": "the number of {group} is fewer than {value}",
  "forms.sentence.count.lte": "the number of {group} is at most {value}",
  /** Unknown operators must render an admission, never an internal token dressed as prose. */
  "forms.sentence.op.unknown": "a condition this build cannot describe ({op})",

  "forms.operand.true": "Yes",
  "forms.operand.false": "No",
  "forms.operand.item": "Value {position}",
  "forms.operand.add": "Add value",
  "forms.operand.remove": "Remove value {position}",
  "forms.operand.noOptions": "The pinned version of this question declares no options.",
  "forms.operand.unsupported": "This operator does not apply to this question's type.",

  "forms.json.label": "Condition JSON for rule {ruleId}",
  "forms.json.note":
    "The same condition as the pickers above, in the engine's own DSL. Editing here updates the pickers; the pickers are the primary surface (ADR-19). Autocomplete offers operators, pinned question IDs, and the option IDs of the referenced question's pinned version.",
  "forms.json.parseError":
    "Not valid JSON yet, so the condition above is unchanged. The pickers still hold the last version that parsed.",
  "forms.json.shapeError": "Valid JSON, but not a condition this editor can render.",

  "forms.bench.title": "Rule test bench",
  "forms.bench.rule": "Rule",
  "forms.bench.noRules": "Add a rule to try it here.",
  "forms.bench.note":
    "A read-only preview. Answers typed here are evaluated against the draft on your screen and are never saved, never logged, and never seen by a respondent.",
  "forms.bench.answers": "Hypothetical answers",
  /** The bench must vary group rosters as well as answers and make the zero-instance case discoverable. */
  "forms.bench.instances": "Hypothetical instances",
  "forms.bench.instancesNote":
    "Set how many instances each repeating group has. Zero is worth trying: a rule that reads a whole group behaves differently when the group is empty.",
  "forms.bench.instanceCount": "Instances of {group}",
  "forms.bench.instanceSuffix": " (instance {position})",
  "forms.bench.instanceMatch": "Instance {position}: matches",
  "forms.bench.instanceNoMatch": "Instance {position}: does not match",
  "forms.bench.noInstances":
    "This rule is evaluated once per instance, and there are no instances, so it matches nothing.",
  "forms.bench.run": "Run preview",
  "forms.bench.noReferences": "This condition reads no question yet.",
  "forms.bench.unpinned":
    "{questionId} is not pinned in this form, so there is no version to answer it against and it counts as unanswered.",
  "forms.bench.match": "Matches. The rule's targets would be shown.",
  "forms.bench.noMatch": "Does not match. The rule's targets would stay hidden.",
  "forms.bench.unavailable": "Could not be evaluated, which is not the same as not matching.",
  "forms.bench.reason.unparseableDraft":
    "The draft is not a form the engine can compile yet, so no rule in it can be evaluated.",
  "forms.bench.reason.ruleNotFound": "That rule is not in the draft that was sent.",
  "forms.bench.reason.noTarget": "This rule shows nothing, so there is no outcome to preview.",
  "forms.bench.reason.unresolvedAnswers":
    "One of the questions this condition reads has no answer the engine could resolve.",
  "forms.bench.failed": "The preview could not be run. {message}",

  "forms.bench.digest.noRules": "No rules to try",
  "forms.bench.digest": "{rule}, reads {questions}",
  "forms.bench.digest.questionOne": "1 question",
  "forms.bench.digest.questionOther": "{count} questions",

  "forms.settings.title": "Form settings",
  "forms.settings.note": "Abuse controls for this form. They apply the next time it is published.",
  "forms.settings.challengeRequired": "Require a challenge before answering",
  "forms.settings.challengeHint":
    "Starting a session has to pass this deployment's challenge check first.",
  /** Describe deployment behavior without exposing provider flags. */
  "forms.settings.challengeUnenforceable":
    "This deployment cannot check a challenge, so requiring one here enforces nothing until an operator configures a challenge provider.",
  "forms.settings.minSubmitDefault": "Use the deployment's minimum time",
  "forms.settings.minSubmit": "Minimum time before a submit is accepted (milliseconds)",
  "forms.settings.minSubmitHint":
    "A submit that arrives faster than this is refused. It exists to make an instant automated post fail, so keep it well under the time a person needs.",

  "forms.settings.failed": "The settings could not be saved. {message}",

  "forms.settings.digest": "{challenge}, {minSubmit}",
  "forms.settings.digest.challengeOn": "Challenge required",
  "forms.settings.digest.challengeOff": "No challenge",
  "forms.settings.digest.minSubmitDefault": "deployment minimum time",
  "forms.settings.digest.minSubmitValue": "minimum time {ms} ms",

  "forms.action.cancel": "Cancel",

  "forms.issue.danglingQuestion":
    "This names a question the form does not pin. Pin it, or change the reference.",
  "forms.issue.danglingOption":
    "This names an option the pinned version of that question does not declare. Moving a pin can do this: option IDs belong to a version.",
  "forms.issue.danglingStep": "This names a step the form does not have.",
  "forms.issue.unpublishedPin":
    "A form can only pin a published version. Publish that version, or pin one that already is.",
  "forms.issue.localeIncomplete": "This has no text for the form's default locale.",

  "forms.issue.backwardTarget":
    "A rule can only show something that comes after every question its condition reads, so a target earlier in the form could never fire.",
  "forms.issue.cycle":
    "These rules depend on each other in a loop, so no order of evaluation resolves them.",
  "forms.issue.depthExceeded": "This condition is nested deeper than the engine evaluates.",
  "forms.issue.typeMismatch":
    "This operator does not apply to the type of the question it reads. On a multiple-choice question, equals compares the whole answer and contains tests membership (ADR-21).",
  "forms.issue.duplicateQuestion":
    "A question can appear in a form once. Remove one of the two pins.",
  "forms.issue.duplicateStep": "Two steps share an ID, so a rule targeting it would be ambiguous.",
  "forms.issue.deprecatedPin":
    "This pin points at a deprecated version. It keeps working exactly as it is, and a new pin cannot be made to it.",
  /** Existing pins keep working; only new pins are subject to the workspace rule. */
  "forms.issue.foreignWorkspacePin":
    "This pin points at a question another workspace owns. Pins that were already published keep working; a new one needs a question in this form's own workspace or in the shared library.",
  "forms.issue.unknown": "The engine reported an issue this screen has no wording for ({code}).",

  "forms.issue.blankText":
    "This text is only whitespace, so it would reach a respondent as no text at all. Type something, or remove the entry.",

  "forms.issue.duplicateGroup":
    "Two repeating groups share an ID, so a rule reading one of them would be ambiguous.",
  "forms.issue.danglingGroup":
    "This rule reads a repeating group the form does not have, so it would publish and never fire. Point it at a group this form declares, or remove the condition.",
  /** A bounded group maximum is required because it is the only declared respondent instance ceiling. */
  "forms.issue.repeatMaxMissing":
    "This group needs a maximum. Its count is not fixed, so the maximum is the only limit on how many instances a respondent can add.",
  "forms.issue.repeatMinAboveMax":
    "This group's minimum is above its maximum, which no instance count can satisfy.",
  "forms.issue.repeatNesting": "A repeating group cannot sit inside another repeating group.",
  "forms.issue.repeatCountBackward":
    "The question this group takes its count from has to come before the whole group, because rules are evaluated in one forward pass. Move the count question earlier, or move the group later.",
  "forms.issue.repeatCountNotANumber":
    "A group can only take its instance count from a number question.",
  "forms.issue.repeatCountInsideGroup":
    "The question this group takes its count from sits inside a repeating group, so it is answered once per instance and has no single value. Move the count question out of every group.",
  "forms.issue.instanceLabelPlaceholder":
    "The instance heading carries a placeholder nothing fills in, so a respondent would read the braces. The only placeholder is {n}, the instance's position in the list.",
  "forms.issue.repeatOperatorNesting":
    "One group read sits inside another, which costs the product of the two groups' maxima however small the rule looks. Put the two reads side by side under all of / any of instead of inside one another.",
  "forms.issue.readsGroupWithoutOperator":
    'This condition reads a question inside a repeating group, which has one answer per instance rather than one value. Wrap the condition in "at least one instance" or "every instance" over that group, or point the rule at a target inside the same group.',
  /** Split scope-spanning rules into separate rules with the same condition; each retains its meaning. */
  "forms.issue.targetsSpanScopes":
    "This rule shows things in more than one scope ({scopes}). One rule is evaluated in one scope, so split it into two: copy the condition into a second rule, and give each rule the targets from one scope. Neither rule's meaning changes.",
  "forms.issue.targetsSpanScopesBare":
    "This rule shows things in more than one scope. One rule is evaluated in one scope, so split it into two: copy the condition into a second rule, and give each rule the targets from one scope. Neither rule's meaning changes.",

  "forms.issue.scopeForm": "outside every repeating group",
  /** The evaluation budget limits cross-group work, not either group maximum; copy must not prescribe shrinking unrelated groups. */
  "forms.issue.budgetExceeded":
    "This rule is shown once per {targetGroup} (up to {targetMax}) and reads all of {readGroup} (up to {readMax}) each time, which is {product} combinations every time anything is answered - above the engine's limit of {budget}. This is about this one rule's cost, not about either group's size: neither maximum is too large, and both groups publish fine without a rule that reads across them. Narrow the rule, or show it somewhere outside {targetGroup}.",
  "forms.issue.tableColumnType":
    "A table column cannot be this question's type. Change the group's presentation to stacked, or use a question of an allowed type.",

  /** Warnings do not block publication; keep that distinction from refusal issues. */
  "forms.warning.heading": "Worth a look",
  "forms.warning.countOne": "1 thing would publish but may not behave as written.",
  "forms.warning.count": "{count} things would publish but may not behave as written.",
  "forms.warning.multiChoiceSameStep":
    "A multiple-choice answer is only counted once the respondent leaves the group, so a question revealed on the same step appears after they move on rather than as they tick. A target on a later step reveals when they continue.",
  "forms.warning.patternClassSet":
    "This pattern uses a character class the browser and the engine read differently, so it can accept different answers in each. Rewrite the class if the two characters were meant literally.",

  "forms.error.invalidId": "That is not a valid form ID.",
  "forms.error.invalidLocale": "That is not a locale the engine recognises.",
  "forms.error.idTaken":
    "A form already uses that ID. IDs are never reused for a different meaning, so choose a different slug (R6).",
  "forms.error.notFound": "That form does not exist.",
  "forms.error.idMismatch": "This draft names a different form than the one being edited.",
  "forms.error.invalidDefinition":
    "The engine could not read this draft. The details are in the validation panel.",
  "forms.error.ruleNotFound": "That rule is not in the draft that was sent.",
  "forms.error.invalidSettings": "Those settings were not accepted.",
  "forms.error.unauthorized": "Your session is no longer valid. Sign in again.",
  "forms.error.rateLimited": "Too many requests just now. Try again shortly.",
  "forms.error.internal": "Something went wrong on the server. Try again.",
  /** A refused accept stores nothing; name the offending question so a multi-question card can be repaired. */
  "forms.error.proposedQuestionRefused":
    "Nothing was saved. The question \u201c{question}\u201d that the assistant proposed was refused: {reason}",
  "forms.error.proposedQuestionIdReused":
    "Nothing was saved. The question ID \u201c{question}\u201d has been used before, and an ID is never reused for a different meaning (R6). Ask the assistant for a different ID.",
  "forms.error.proposedQuestionSlugTaken":
    "Nothing was saved. The library slug for the proposed question \u201c{question}\u201d is already in use. Rename the existing question, or ask the assistant for a different ID.",
  "forms.error.unknownEnvironment":
    "This deployment serves no such environment. Pick one from the environment switcher.",
  "forms.error.unknown": "The request failed ({code}).",

  "forms.error.approverIsAuthor":
    "You published this version, so you cannot release it to production. This workspace requires an approver other than the version's author: ask another approver to release it.",
  "forms.error.approverUnknownAuthor":
    "This version was published before the deployment recorded publishing accounts, so the second-approver rule cannot be checked against it. Publish a new version and release that one.",
  "forms.error.unknownCreate": "The form could not be created. Try again.",
  "forms.error.listFailed": "The form library could not be loaded. {message}",
  "forms.error.libraryFailed": "The question library could not be loaded. {message}",

  /** Lifecycle controls affect new sessions, never already-pinned sessions. Secure-link URLs are revealed only once because the API does not store bearer tokens. */
  "forms.tab.builder": "Form details",

  "forms.tab.rules": "Rules",
  "forms.tab.preview": "Preview",
  "forms.tab.versions": "Versions",
  "forms.tab.links": "Links",

  "forms.tab.publish": "Publish",

  "forms.publish.action": "Publish",
  /** Pluralize each count separately; a single sentence cannot choose the correct form for three independent numbers. */
  "forms.publish.freezes": "Freezes {steps}, {pins}, {rules}.",
  "forms.publish.freezes.steps.one": "1 step",
  "forms.publish.freezes.steps.other": "{count} steps",
  "forms.publish.freezes.pins.one": "1 pinned question",
  "forms.publish.freezes.pins.other": "{count} pinned questions",
  "forms.publish.freezes.rules.one": "1 rule",
  "forms.publish.freezes.rules.other": "{count} rules",
  "forms.publish.immutable":
    "A published version is never edited. Your next change starts a fresh draft, seeded from this one.",
  "forms.publish.blocked": "This draft cannot be published yet.",
  "forms.publish.blockedCount": "{count} issues block publishing. Each one links to its cause.",

  "forms.publish.blockedAnnounce.one": "Publish blocked: 1 issue to fix, listed below.",
  "forms.publish.blockedAnnounce.other": "Publish blocked: {count} issues to fix, listed below.",

  /** Closing targets one environment; title, body and confirm control must not imply a global stop. */
  "forms.lifecycle.close": "Close in {environment}",
  "forms.lifecycle.reopen": "Reopen in {environment}",
  "forms.lifecycle.closeTitle": "Close {slug} to new sessions in {environment}?",
  "forms.lifecycle.closeBody":
    "No one can start this form in {environment} after it closes. Every other environment is unaffected: a test run keeps going if one is under way. Sessions already under way here keep going too and finish on the version they pinned (R1); their answers are unaffected.",
  "forms.lifecycle.reopenTitle": "Reopen {slug} in {environment}?",
  "forms.lifecycle.reopenBody":
    "New sessions can start in {environment} again, on the version released there.",
  "forms.lifecycle.confirmClose": "Close it in {environment}",
  "forms.lifecycle.confirmReopen": "Reopen it in {environment}",
  "forms.lifecycle.cancel": "Cancel",
  "forms.lifecycle.pending": "Working...",
  "forms.lifecycle.failed": "The form status did not change. {message}",
  "forms.lifecycle.closedNote":
    "This form is closed in {environment}. New sessions there are refused; in-flight sessions finish normally, and other environments are unaffected.",
  "forms.lifecycle.notReleasedHere":
    "Nothing is released in this environment, so there is no intake to close there. Release a version first.",
  "forms.lifecycle.alreadyClosedHere":
    "Intake in this environment is already closed. Nothing changed, and nothing was recorded.",
  "forms.lifecycle.alreadyOpenHere":
    "Intake in this environment is already open. Nothing changed, and nothing was recorded.",

  "forms.releases.currentHeading": "Released now",
  "forms.releases.currentTable": "The version released to each environment",
  "forms.releases.column.environment": "Environment",
  "forms.releases.column.version": "Version",
  "forms.releases.column.releasedAt": "Released",
  "forms.releases.column.releasedBy": "Released by",
  "forms.releases.column.fromEnvironment": "Promoted from",
  "forms.releases.column.approvedBy": "Approved by",
  "forms.releases.none": "Nothing released",
  "forms.releases.noSource": "Released directly",
  "forms.releases.noApproval": "No approval recorded",
  "forms.releases.historyHeading": "Release history",
  "forms.releases.historyTable": "Every release of this form",
  "forms.releases.emptyTitle": "Not released anywhere",
  "forms.releases.empty":
    "This form has never been released. Publishing a version does not serve it: release it to an environment to put it in front of respondents.",
  "forms.releases.notPublished":
    "There is nothing to release yet: publish a version first, and it becomes releasable.",

  "forms.releases.rollback": "Rollback",
  "forms.releases.rollbackFrom": "Rolled back from v{replaced}",
  "forms.releases.replaced": "Replaced v{replaced}",
  "forms.releases.first": "First release here",
  "forms.releases.action": "Release a version…",
  "forms.releases.dialogTitle": "Release v{version} to {environment}?",
  "forms.releases.dialogBody":
    "This becomes the version new sessions in {environment} start on. Sessions already under way stay on the version they pinned, and every earlier release stays in the history.",
  "forms.releases.rollbackWarning":
    "This is a rollback: {environment} is on v{current}, and v{version} is older.",
  /** The production rule compares two accounts: publisher and releaser, not job titles. */
  "forms.releases.twoPersonSelf":
    "You published v{version}, so you cannot release it to {environment}. This workspace requires an approver other than the version's author: ask another approver to release it.",
  "forms.releases.twoPersonSecond":
    "This workspace requires a second approver for {environment}. You did not publish this version, so you can release it, and your account is recorded as the approval.",
  "forms.releases.twoPersonUnknown":
    "v{version} was published before this deployment recorded publishing accounts, so the second-approver rule cannot be checked against it. Publish a new version and release that one.",
  "forms.releases.version": "Version to release",
  "forms.releases.fromEnvironment": "Promoted from (optional)",
  "forms.releases.fromNone": "Nowhere: release it directly",
  "forms.releases.confirm": "Release to {environment}",
  "forms.releases.cancel": "Cancel",
  "forms.releases.pending": "Releasing...",
  "forms.releases.released": "v{version} is now released to {environment}.",
  "forms.releases.failed": "Nothing was released. {message}",
  "forms.releases.rollbackDone": "v{version} is released to {environment} again, as a rollback.",

  /** Available in means serving now; historical destinations must not appear live. */
  "forms.versions.availableIn": "Available in",
  "forms.versions.availableNowhere": "Nowhere",
  "forms.versions.publishedBy": "Published by",
  "forms.versions.publisherUnknown": "Not recorded",
  "forms.versions.review": "Review",

  "forms.versions.reviewVersion": "Review version {version}",
  "forms.versions.summaryHeading": "What each environment is serving",
  "forms.versions.intakeOpen": "Open",
  "forms.versions.intakeClosed": "Closed",
  "forms.versions.column.intake": "Intake",
  "forms.versions.publishEntry": "Publish…",

  "forms.publish.intro":
    "Choose what to publish and where it goes. Nothing is written until you confirm, and a " +
    "confirmation releases into every destination or into none of them.",
  "forms.publish.step.source": "What to publish",
  "forms.publish.step.destinations": "Where it goes",
  "forms.publish.step.review": "Review and confirm",
  "forms.publish.step.announce": "Step: {step}",
  "forms.publish.source.draft": "The shared draft",
  "forms.publish.source.draftHint": "Publishing freezes a new immutable version of the draft.",
  "forms.publish.source.version": "An existing version",
  "forms.publish.source.versionLabel": "Version to release",
  "forms.publish.source.noDraft": "There is no saved draft to publish.",
  "forms.publish.source.noVersions": "No version of this form has been published yet.",
  "forms.publish.source.publishedBy": "Published by {publisher}.",
  "forms.publish.destinations.hint":
    "Only the environments you may release this form into are listed.",
  "forms.publish.destinations.none":
    "You hold no release permission for this form in any environment.",
  "forms.publish.destinations.publishOnly": "Create version without releasing",
  "forms.publish.destinations.publishOnlyHint":
    "Freezes a new version and releases it nowhere. Another account can release it afterwards.",
  "forms.publish.destinations.serving": "Serving v{version}",
  "forms.publish.destinations.unreleased": "Nothing released here",
  "forms.publish.destinations.closedNote": "Intake is closed here, and releasing leaves it closed.",
  "forms.publish.destinations.protected": "Production",
  "forms.publish.destinations.rollbackNote": "This moves {environment} back from v{current}.",
  "forms.publish.destinations.evidence": "Satisfied by the release of v{version} in {environment}.",
  "forms.publish.destinations.pickOne": "Choose at least one destination.",
  "forms.publish.workflow.default":
    "No release workflow is configured, so this deployment's default rules apply.",
  "forms.publish.workflow.configured": "Release workflow revision {revision}.",
  "forms.publish.blocked.priorRelease":
    "Not yet eligible: this version needs a release in {environments} first.",
  "forms.publish.blocked.draftNotAllowed":
    "A draft cannot be published straight into {environment}. Release an existing version here.",
  "forms.publish.blocked.alreadyReleased": "Already the released version here.",
  "forms.publish.blocked.approverIsAuthor":
    "You published this version, and {environment} requires a second account to release it.",
  "forms.publish.blocked.approverUnknownAuthor":
    "The publisher of this version was not recorded, so the second-account rule cannot be checked.",
  "forms.publish.blocked.other": "Not eligible here: {code}.",
  "forms.publish.review.sourceDraft": "The shared draft becomes a new immutable version.",
  "forms.publish.review.sourceVersion": "v{version} is released, and nothing is published.",
  "forms.publish.review.publishOnly":
    "A new version is created and released nowhere. Another account can release it afterwards.",
  "forms.publish.review.transition": "{environment}: v{current} becomes v{version}",
  "forms.publish.review.transitionFirst": "{environment}: nothing released becomes v{version}",
  "forms.publish.review.transitionDraft": "{environment}: v{current} becomes the new version",
  "forms.publish.review.transitionDraftFirst":
    "{environment}: nothing released becomes the new version",
  "forms.publish.review.secondPerson":
    "{environment} requires a second account: this release is recorded against you as the approver.",
  "forms.publish.wizardConfirm": "Confirm",
  "forms.publish.wizardPending": "Confirming...",
  "forms.publish.next": "Continue",
  "forms.publish.back": "Back",
  "forms.publish.wizardCancel": "Cancel",
  "forms.publish.refresh": "Read the review again",
  "forms.publish.reviewing": "Reading the review...",
  "forms.publish.reviewFailed":
    "The review could not be read, so nothing can be confirmed. Try again.",
  "forms.publish.stale":
    "Nothing was written: this form changed while you were reviewing. Read the review again " +
    "and confirm the new one.",
  "forms.publish.uncertain":
    "The confirmation was sent and no answer arrived, so it may or may not have committed. " +
    "Look the result up before trying anything else: retrying would never create a second " +
    "version, but the answer is already recorded if it committed.",
  "forms.publish.lookup": "Look the result up",
  "forms.publish.lookupNothing":
    "Nothing was committed under that confirmation. You can confirm again.",
  "forms.publish.result.heading": "Recorded",
  "forms.publish.result.version": "Version {version} is published.",
  "forms.publish.result.released": "Version {version} is released.",
  "forms.publish.result.replayed":
    "This is the recorded result of the confirmation you already sent, not a second one.",
  "forms.publish.result.releasedIn": "Released to {environment}",
  "forms.publish.result.rolledBackIn": "Released to {environment}, as a rollback",
  "forms.publish.result.noRelease": "Released nowhere.",
  "forms.publish.result.operations": "Open {environment} operations",
  "forms.publish.result.versions": "Back to versions",
  "forms.publish.wizardFailed": "Nothing was published or released. {message}",
  "forms.publish.wizardBlockedCount.one":
    "1 issue blocks publishing. It is listed in the builder, linking to its cause.",
  "forms.publish.wizardBlockedCount.other":
    "{count} issues block publishing. They are listed in the builder, each one linking to " +
    "its cause.",
  "forms.publish.wizardBlockedLink": "Open the builder",

  "forms.workflow.release": "Release v{version} to {environment}",
  "forms.workflow.publishedForm": "Published form",
  "forms.workflow.intake": "Intake",
  "forms.workflow.testCandidate": "This version was released to test.",
  "forms.workflow.firstRelease": "v{version} will be the first version released to {environment}.",
  "forms.workflow.replacesVersion": "v{version} will replace v{current} in {environment}.",
  "forms.workflow.reviewLoading": "Loading the stored content of v{version}...",
  "forms.workflow.reviewFailed":
    "The published version could not be loaded. Close this confirmation and try again.",
  "forms.workflow.alreadyReleased": "v{version} is already released to {environment}.",
  "forms.workflow.noPublishPermission":
    "Publishing here requires permission to publish forms and release versions to {environment}.",
  "forms.workflow.noReleasePermission":
    "You do not have permission to release versions to {environment} in this workspace.",
  "forms.workflow.intakeClosed":
    "The new version is released to {environment}; intake remains closed.",
  "forms.workflow.noCandidate":
    "No version is available to release to {environment}. Publish and verify a version in test first.",
  "forms.workflow.reviewVersion": "Review v{version}",
  "forms.workflow.testRequired":
    "Publish and verify this version in test, then switch to prod and release the existing version.",
  "forms.workflow.noEditPermission":
    "You do not have permission to edit form drafts in this workspace.",
  "forms.workflow.editInTest":
    "Draft changes are shared. Select test in the top navigation to edit and publish them.",
  "forms.workflow.switchToTest": "Switch to test",
  "forms.workflow.noReleasedVersion":
    "Nothing is released in this environment yet. Select a published version on Versions to review and release it.",
  "forms.workflow.reviewCurrent": "Currently released: v{version}",

  "forms.preview.heading": "Preview",
  "forms.preview.banner": "Preview - not published",

  "forms.preview.frame": "Respondent view",
  "forms.preview.explain":
    "This is your draft compiled and rendered through the same renderer a respondent uses. Answer the questions to walk your own branches. Nothing here is saved.",
  "forms.preview.stepOf": "Step {index} of {total}: {title}",

  "forms.preview.stepOfInstance": "Step {index} of {total}: {title}, {instance}",
  "forms.preview.previous": "Previous step",
  "forms.preview.next": "Next step",

  "forms.preview.instances": "Instances of {group}",
  "forms.preview.reset": "Reset answers",
  "forms.preview.loading": "Compiling the draft...",
  "forms.preview.unavailable": "This draft cannot be previewed yet.",
  "forms.preview.unavailableHint":
    "A preview of a draft that publish would refuse would be a promise about what a respondent sees that publish will not keep. Fix these first.",

  "forms.preview.unavailableAnnounce.one": "Preview unavailable: 1 issue to fix, listed below.",
  "forms.preview.unavailableAnnounce.other":
    "Preview unavailable: {count} issues to fix, listed below.",
  "forms.preview.failed": "The preview could not be loaded. {message}",
  "forms.preview.emptyStep": "Nothing on this step is visible for the answers so far.",
  "forms.preview.noSteps": "This draft has no steps to preview yet.",
  "forms.preview.complete": "Every required question on every visible step is answered.",
  "forms.preview.stamps": "Compiler {compilerVersion} · A2UI spec {a2uiSpecVersion}",

  "forms.history.intro":
    "Every published version, frozen exactly as it was. Viewing one renders the compiled documents stored at publish time, which is what respondents on that version saw (ADR-18).",
  "forms.history.emptyTitle": "Not published yet",
  "forms.history.empty": "This form has never been published.",
  "forms.history.table": "Published versions",
  /** Default history shows every immutable version; hiding iterations must be an explicit presentation filter. */
  "forms.history.filter.all": "Every version",
  "forms.history.filter.released": "Released anywhere",
  "forms.history.filter.legend": "Show",
  "forms.history.filter.hidden":
    "{count} versions are hidden because they were never released anywhere.",
  "forms.history.column.released": "Released",
  "forms.history.releasedIn": "{environments}",
  "forms.history.releasedNowhere": "Nowhere",
  "forms.history.column.version": "Version",
  "forms.history.column.publishedAt": "Published",
  "forms.history.column.compilerVersion": "Compiler",
  "forms.history.column.a2uiSpecVersion": "A2UI spec",
  "forms.history.column.semanticsVersion": "Semantics",
  "forms.history.view": "View v{version}",
  "forms.history.versionHeading": "Version {version}",
  "forms.history.stored":
    "Rendered from the compiled documents stored with v{version}. Nothing was recompiled.",
  "forms.history.readOnly": "Read only: a published version is never edited (R1).",

  "forms.history.frame": "Respondent view, as stored at publish",
  "forms.history.backToHistory": "Back to version history",
  "forms.history.stepOf": "Step {index} of {total}: {title}",
  "forms.history.failed": "That version could not be loaded. {message}",
  "forms.history.compare": "Compare",
  "forms.history.clearCompare": "Clear comparison",
  "forms.history.olderLabel": "Older version",
  "forms.history.newerLabel": "Newer version",
  "forms.history.compareNone": "Pick two versions to compare their definitions.",
  "forms.history.compareHeading": "v{older} compared with v{newer}",
  "forms.history.compareIdentical": "These two definitions are identical.",
  "forms.history.compareCounts": "{added} lines added, {removed} lines removed.",
  "forms.history.compareTooLarge":
    "These definitions are too large to compare line by line on screen.",
  "forms.history.compareRowAdded": "Added",
  "forms.history.compareRowRemoved": "Removed",
  "forms.history.compareRowSame": "Unchanged",

  "forms.links.heading": "Secure links",
  "forms.links.intro":
    "A secure link is a signed, expiring invitation to one form. Mint them here, hand them out, and revoke any that should stop working.",
  "forms.links.needsPublish":
    "Publish this form before minting links: a link opens the newest published version, and there is not one yet.",
  "forms.links.mint": "Mint links",
  /** Restate mint environment in title and confirmation because links determine where respondent answers land. */
  "forms.links.mintTitle": "Mint secure links for {environment}",
  "forms.links.mintEnvironment":
    "These links will start sessions in {environment}, and nowhere else. A non-production link carries the environment's name in its address.",
  "forms.links.expiresAt": "Expires",
  /** Mint expiry is end-of-day UTC; operator-local table display must not change that promise. */
  "forms.links.expiresAtHint": "The link stops working at the end of this day, UTC, used or not.",
  "forms.links.oneTime": "One-time (stops working after the first use)",
  "forms.links.count": "How many",
  "forms.links.countHint": "Up to {max} at a time.",
  "forms.links.confirmMint": "Mint for {environment}",
  "forms.links.pending": "Minting...",
  "forms.links.cancel": "Cancel",
  "forms.links.mintFailed": "No links were minted. {message}",
  "forms.links.mintedTitle.one": "1 link minted",
  "forms.links.mintedTitle.other": "{count} links minted",
  "forms.links.mintedOnce":
    "Copy these now. The server stores a link's state, never its token, so these URLs cannot be shown again.",
  "forms.links.mintedEnvironment": "These links are for {environment}.",
  /** Never announce bearer URLs aloud; announce success and the one-time opportunity to copy them. */
  "forms.links.mintedAnnounce.one":
    "1 secure link minted. It is listed below and cannot be shown again.",
  "forms.links.mintedAnnounce.other":
    "{count} secure links minted. They are listed below and cannot be shown again.",
  "forms.links.copy": "Copy URL",
  "forms.publicLink.heading": "Public form link",
  "forms.publicLink.copy": "Copy",
  "forms.publicLink.opensNewTab": "(opens in a new tab)",
  "forms.publicLink.helpLabel": "What is this link?",

  "forms.publicLink.hintOpen":
    "Anyone with this link can start a response while this form stays published and open. It never expires and it is never used up, which is what makes it different from the secure links below.",
  "forms.publicLink.hintClosed":
    "This form is closed, so anyone opening this link is told so rather than starting a response. The address never changes and works again if the form is reopened, which is what makes it different from the secure links below.",
  "forms.links.copied": "Link copied to the clipboard.",
  "forms.links.copyFailed": "The link could not be copied. Select the text and copy it manually.",
  "forms.links.exportCsv": "Download as CSV",
  "forms.links.dismissMinted": "Done",
  "forms.links.table": "Secure links",
  "forms.links.column.linkId": "Link",
  "forms.links.column.state": "State",
  "forms.links.column.oneTime": "One-time",
  "forms.links.column.expiresAt": "Expires",
  "forms.links.column.createdAt": "Minted",
  "forms.links.column.usedAt": "Used",
  "forms.links.emptyTitle": "No links yet",
  "forms.links.empty": "No links have been minted for this form.",
  "forms.links.yes": "Yes",
  "forms.links.no": "No",
  "forms.links.none": "-",
  "forms.links.state.active": "Active",
  "forms.links.state.consumed": "Used",
  "forms.links.state.expired": "Expired",
  "forms.links.state.revoked": "Revoked",
  "forms.links.revoke": "Revoke",
  "forms.links.revokeTitle": "Revoke this link?",
  "forms.links.revokeBody":
    "The link stops working immediately and cannot be restored. A session already started with it finishes normally (R1).",
  "forms.links.confirmRevoke": "Revoke it",
  "forms.links.revoked": "That link is revoked.",
  "forms.links.revokeFailed": "The link was not revoked. {message}",
  "forms.links.noPublicAddress":
    "{environment} has no public form address. A non-production environment is reached through secure links only, which is what keeps an unreleased version off the open internet.",
  "forms.links.environmentScope":
    "This table lists {environment}'s links. A link minted for another environment is listed, and revocable, under that environment.",
  "forms.links.listFailed": "The links could not be loaded. {message}",

  "forms.error.invalidLinkId": "That is not a valid link.",
  "forms.error.linkNotFound": "That link no longer exists, or it is already revoked.",
  "forms.error.linkExpiryInvalid": "Pick an expiry in the future.",
  "forms.error.invalidLinkBatch": "Ask for between 1 and {max} links.",
  "forms.error.noDraft": "There is no draft to publish.",
  "forms.error.publishRejected": "The draft cannot be published yet. The reasons are listed below.",
  "forms.error.previewRejected": "The draft cannot be previewed yet. The reasons are listed below.",

  "forms.error.previewUnavailable":
    "This draft compiled, but its rules could not be evaluated for the answers entered. Reset the answers to start again.",
  "forms.error.versionNotFound": "That version does not exist.",

  /** Accept updates only the working draft and never publishes. Diff meaning must not depend on plus signs or color alone. */
  "agent.title": "Assistant",
  "forms.assist.working": "The assistant is working.",
  "forms.assist.thinking": "Thinking",
  "forms.assist.thoughtFor": "Thought for {seconds} s",

  "forms.assist.stepsLabel": "Steps the assistant took",
  "forms.assist.stepRunning": "In progress",
  "forms.assist.stepDone": "Done",
  /** Only the API can mark a step done; a stream ending without an outcome means interrupted. */
  "forms.assist.stepFailed": "Failed",
  "forms.assist.stepInterrupted": "Did not finish",
  "forms.assist.step.search_question_library": "Searching the question library",
  "forms.assist.step.propose_questions": "Drafting questions",
  "forms.assist.step.propose_draft": "Drafting the form",
  "forms.assist.step.validate_draft": "Checking the draft",
  "agent.open": "Open the assistant",
  "agent.open.tooltip": "Open the assistant (Alt+Shift+A)",
  "agent.working": "Working",
  "agent.new": "New conversation",
  "agent.new.announce": "Started a new conversation.",
  "agent.expand": "Expand the assistant",
  "agent.help": "Assistant help",
  "agent.help.shortcut": "Alt+Shift+A opens or focuses the assistant.",
  "agent.close": "Close the assistant",
  "agent.width.separator": "Assistant panel width",
  "agent.width.legend": "Panel width",
  "agent.width.320": "Narrow",
  "agent.width.400": "Default",
  "agent.width.560": "Wide",
  "agent.context.none": "Nothing on this screen",
  "agent.context.forms": "Forms you can read",
  "agent.context.forms.new": "A new form, nothing saved yet",
  "agent.context.form.draft": "Form: {subject}, draft",
  "agent.context.form.rules": "Form {subject}: draft rules",
  "agent.context.form.preview": "Form {subject}: draft preview",
  "agent.context.form.versions": "Form {subject}: versions",
  "agent.context.form.version": "Form {subject}: version {version}",
  "agent.context.form.publish": "Form {subject}: publish",
  "agent.context.form.links": "Form {subject}: links",
  "agent.context.form.webhooks": "Form {subject}: webhooks, no payloads",
  "agent.context.form.responses": "Form {subject}: response metadata, no answers",
  "agent.context.form.response": "Form {subject}: session {session}, metadata only",
  "agent.context.questions": "The question library",
  "agent.context.questions.new": "A new question, nothing saved yet",
  "agent.context.question": "Question {subject}",
  "agent.context.access": "Your own access",
  "agent.context.operations": "Forms and their state",
  "agent.context.responses": "Response metadata across forms, no answers",
  "agent.context.erasures": "Erasure requests and their state",
  "agent.context.settings": "Workspace settings",
  "agent.context.webhooks": "Endpoints and delivery state, no payloads",
  "agent.context.workspaces": "Workspaces you can read",
  "agent.context.workspace": "Workspace {subject}",
  "agent.empty": "Ask about this screen. The assistant explains what is here and takes you to it.",
  "agent.composer": "Ask the assistant",
  "agent.conversationLabel": "Conversation with the assistant",
  "agent.send": "Send",
  "agent.stop": "Stop",
  "agent.announce.working": "The assistant is working.",
  "agent.announce.done": "The assistant finished.",
  "agent.announce.stopped": "The assistant stopped.",
  "agent.announce.failed": "The assistant could not finish that turn.",
  "agent.announce.cardExpired": "The waiting card expired because you left the screen it was for.",
  "agent.trimmed": "This conversation reached its length limit, so the oldest turns were dropped.",
  "agent.sidebar.shown": "Showed the sidebar and closed the assistant.",
  "forms.assist.step.project_draft": "Trying the draft out",
  "forms.assist.step.other": "Working on your request",
  "forms.assist.step.test_rule": "Trying a rule out",
  "forms.assist.step.diff_form_versions": "Comparing two versions",
  "forms.assist.step.count_links": "Counting the links",
  "forms.assist.step.list_responses": "Listing the responses",
  "forms.assist.step.count_responses": "Counting the responses",
  "forms.assist.step.delivery_status": "Checking the deliveries",
  "forms.assist.step.count_dead_letters": "Counting the dead letters",
  "forms.assist.step.diff_question_versions": "Comparing two question versions",
  "forms.assist.step.search_forms": "Searching the forms",
  "forms.assist.step.propose_action": "Preparing an action for you to confirm",
  "forms.assist.step.propose_plan": "Preparing a plan for you to confirm",

  "forms.assist.diffCount.one": "1 change proposed.",
  "forms.assist.diffCount.other": "{count} changes proposed.",
  "forms.assist.validationClean": "Validation passes.",
  "forms.assist.diffAdded": "Added: {label}",
  "forms.assist.diffChanged": "Changed: {label}",
  "forms.assist.diffEmpty": "This proposal makes no changes to the current draft.",
  "forms.assist.kind.step": "Step",
  "forms.assist.kind.question": "Question",
  "forms.assist.kind.rule": "Rule",
  "forms.assist.newQuestionPending":
    "New question {questionId}. Accepting creates it as an unpublished draft in the question library. Publish it there before you publish this form.",

  /** Action-card consequences must mirror ordinary dialog consequences and come only from registered catalog templates, never model prose. */
  "agent.card.planTitle.one": "1 step",
  "agent.card.planTitle.other": "Plan · {count} steps",
  "agent.card.stepsLabel": "The steps this plan runs, in order",

  "agent.card.reasonLabel": "Reason",

  "agent.card.question.create.title": "Create the question {slug} in the library",
  "agent.card.question.create.consequence":
    "The question and its draft v1 are created. Its id is minted once and never changes. No form serves it until the version is published and a form's draft pins it.",
  "agent.card.question.saveDraft.title": "Save draft v{version} of {questionId}",
  "agent.card.question.saveDraft.consequence":
    "The draft's definition is replaced by the one on this card. A published or deprecated version is refused instead: published content never changes.",
  "agent.card.question.publish.title": "Publish v{version} of {questionId}",
  "agent.card.question.publish.consequence":
    "This version's content is frozen for good and becomes pinnable. A form's draft that pins it stops reporting an unpublished pin.",
  "agent.card.question.deprecate.title": "Deprecate v{version} of {questionId}",
  "agent.card.question.deprecate.consequence":
    "No new form draft can pin this version. Every form already pinned to it keeps serving it, untouched.",
  "agent.card.question.newVersion.title": "Open a new draft version of {questionId}",
  "agent.card.question.newVersion.consequence":
    "A new draft is seeded from the latest version. Nothing published changes, and no form moves to it until a draft pins it.",
  "agent.card.form.create.title": "Create the form {slug}",
  "agent.card.form.create.consequence":
    "The form and an empty first draft are created. Its id is minted from the slug once and never changes, and no respondent can reach it until it is published and released.",
  "agent.card.form.publish.title":
    "Publish {formId} as a new version and release it to {environment}",
  "agent.card.form.publish.consequence":
    "The working draft becomes an immutable version, and that version is released to {environment} in the same act. Respondents starting from now get it there.",
  "agent.card.form.release.title": "Release version {version} of {formId} to {environment}",
  "agent.card.form.release.consequence":
    "Respondents starting from now get this version in {environment}.",
  "agent.card.apply-draft.title": "Apply the proposed draft to {formId}",
  "agent.card.apply-draft.consequence":
    "The working draft is replaced by the one below. It publishes nothing and releases nothing: respondents see no change until this form is published.",
  "agent.card.apply-draft.provenance":
    "The draft is marked as carrying agent-assisted changes, and keeps that mark until it is published.",
  "agent.card.form.settings.title": "Change the form settings of {formId}",
  "agent.card.form.settings.consequence":
    "Abuse controls for this form. They apply the next time it is published.",
  "agent.card.form.close.title": "Close {formId} to new sessions in {environment}",
  "agent.card.form.close.consequence":
    "No one can start this form in {environment} after it closes. Every other environment is unaffected: a test run keeps going if one is under way. Sessions already under way here keep going too and finish on the version they pinned (R1); their answers are unaffected.",
  "agent.card.form.reopen.title": "Reopen {formId} in {environment}",
  "agent.card.form.reopen.consequence":
    "New sessions can start in {environment} again, on the version released there.",
  "agent.card.webhook.create.title": "Add a delivery endpoint at {url}",
  "agent.card.webhook.create.consequence":
    "This form's events are delivered to that URL in {environment}, signed with a secret.",
  "agent.card.webhook.create.secret":
    "The signing secret is shown here once. It cannot be read again, and it never reaches the assistant.",
  "agent.card.webhook.rotate.title": "Rotate the signing secret of endpoint {webhookId}",
  "agent.card.webhook.rotate.consequence":
    "Every consumer verifying with the old secret starts rejecting the moment the next delivery is signed.",
  "agent.card.webhook.retarget.title": "Point endpoint {webhookId} at {url}",
  "agent.card.webhook.retarget.consequence":
    "Deliveries go to the new URL from now on. Nothing already in flight is re-aimed.",
  "agent.card.webhook.reactivate.title": "Put endpoint {webhookId} back in service",
  "agent.card.webhook.reactivate.consequence":
    "Deliveries to that endpoint resume in {environment}.",
  "agent.card.webhook.deactivate.title": "Stop delivering to endpoint {webhookId}",
  "agent.card.webhook.deactivate.consequence":
    "The endpoint and its delivery history stay. A delivery already in flight keeps its own retry state.",
  "agent.card.webhook.redeliver.title": "Redeliver {deliveryId}",
  "agent.card.webhook.redeliver.consequence":
    "The delivery is reset to due-now and the worker attempts it again.",
  "agent.card.link.mint.title": "Mint {count} respondent links for {formId}",
  "agent.card.link.mint.consequence":
    "Each link opens this form for one respondent. The URLs are shown to you once and cannot be read again.",
  "agent.card.response.erase.title": "Erase the respondent data for {sessionId}",
  "agent.card.response.erase.consequence":
    "The answers and the submission are deleted. There is no undo, no archive and no restore.",
  "agent.card.response.erase.tombstone":
    "A tombstone records that the session existed, who erased it, when and why. It carries no answer.",
  "agent.card.response.unflag.title": "Release the withheld submission for {sessionId}",
  "agent.card.response.unflag.consequence":
    "The withheld submission event is sent to this form's consumers. The response itself is unchanged.",
  "agent.card.response.export.title": "Export this form's responses as {format}",
  "agent.card.response.export.consequence":
    "The file is built from the responses these filters match and downloads in your browser.",
  "agent.card.response.export.handOff":
    "Confirm opens the export dialog with these filters. You press Export, and no part of the file is returned to the assistant.",
  "agent.card.access.groupCreate.title": "Create the access group {name} with the role {role}",
  "agent.card.access.groupCreate.consequence":
    "The group exists but grants nobody anything yet. Holding the group is the grant, so nobody's access changes until somebody is added to it.",
  "agent.card.access.groupRemove.title": "Remove the access group {teamId}",
  "agent.card.access.groupRemove.consequence":
    "Every holder loses the access this group carried, at once. One revoke row is written for each of them.",
  "agent.card.access.grant.title": "Grant the access group {teamId} to {email}",
  "agent.card.access.grant.consequence":
    "That person gains everything the group's role, environments and forms allow, from now on.",
  "agent.card.access.revoke.title": "Revoke {userId} from the access group {teamId}",
  "agent.card.access.revoke.consequence":
    "That person loses the access this group carried. Every other holder keeps theirs.",
  "agent.card.member.role.title": "Set {userId} to {role} in this workspace",
  "agent.card.member.role.consequence":
    "An owner looks after this workspace: its access groups, its members and its settings. Removing the last owner is refused.",
  "agent.card.workspace.settings.title": "Change this workspace's settings",
  "agent.card.workspace.settings.consequence":
    "These two switches decide whether a production release and a responses self-grant need a second account, and whether a new editor is granted the dev and test response data.",
  "agent.card.link.revoke.title": "Revoke link {linkId}",
  "agent.card.link.revoke.consequence":
    "The link stops working from now on. A session already in progress is unaffected.",

  "agent.card.environment.production": "Production: changes where respondents' answers are sent.",
  "agent.card.environmentLabel": "Environment",
  "agent.card.usesStep": "Uses the {field} step {step} sets",

  "agent.card.fromStepShort": "step {step}'s {field}",

  "agent.card.openCreated": "Open what this created",
  "agent.card.arg.formId": "Form",
  "agent.card.arg.slug": "Slug",
  "agent.card.arg.questionId": "Question",
  "agent.card.arg.definition": "Definition",
  "agent.card.arg.defaultLocale": "Authoring locale",
  "agent.card.arg.label": "Label",
  "agent.card.arg.count": "How many",
  "agent.card.arg.expiresAt": "Stops working",
  "agent.card.arg.oneTime": "One respondent each",
  "agent.card.arg.version": "Version",
  "agent.card.arg.environment": "Environment",
  "agent.card.arg.fromEnvironment": "Promoted from",
  "agent.card.arg.linkId": "Link",
  "agent.card.arg.url": "URL",
  "agent.card.arg.active": "Delivering",
  "agent.card.arg.webhookId": "Endpoint",
  "agent.card.arg.deliveryId": "Delivery",
  "agent.card.arg.sessionId": "Session",
  "agent.card.arg.reason": "Reason",
  "agent.card.arg.format": "File format",
  "agent.card.arg.shape": "Rows",
  "agent.card.arg.from": "From day",
  "agent.card.arg.to": "To day",
  "agent.card.arg.challengeRequired": "Require a challenge before answering",
  "agent.card.arg.minSubmitMs": "Minimum time before a submit is accepted (milliseconds)",
  "agent.card.arg.workspaceId": "Workspace",
  "agent.card.arg.teamId": "Access group",
  "agent.card.arg.userId": "Person",
  "agent.card.arg.email": "Address",
  "agent.card.arg.name": "Name",
  "agent.card.arg.role": "Role",
  "agent.card.arg.environments": "Environments",
  "agent.card.arg.forms": "Forms",
  "agent.card.arg.requireSecondApprover": "Require a second approver",
  "agent.card.arg.seedNewEditorsWithTestData": "Seed a new editor with dev and test data",
  "agent.card.arg.unset": "The deployment's own setting",
  "agent.card.arg.yes": "Yes",
  "agent.card.arg.no": "No",

  /** Each state needs words and an icon; color alone cannot communicate it. */
  "agent.card.state.proposed": "Proposed",
  "agent.card.state.running": "Running",
  "agent.card.state.done": "Done",
  "agent.card.state.failed": "Failed",
  "agent.card.state.pendingApproval": "Pending approval",
  "agent.card.state.notRun": "Not run",
  "agent.card.state.cancelled": "Cancelled",
  "agent.card.state.expired": "Expired",

  "agent.card.chip.proposed": "Proposed",
  "agent.card.chip.running": "Running {step} of {count}",
  "agent.card.chip.done": "Done",
  "agent.card.chip.stopped": "Stopped at step {step}",
  "agent.card.chip.stoppedByYou": "Stopped",
  "agent.card.chip.pending": "Pending approval",
  "agent.card.chip.cancelled": "Cancelled",
  "agent.card.chip.expired": "Expired",

  "agent.card.band.irreversible":
    "This cannot be undone. Nothing here is archived and nothing can be restored.",
  "agent.card.revealOnce": "Shown once, here only:",
  "agent.card.typed.label": "Type the session id to confirm",
  "agent.card.typed.hint": "Type {value} exactly.",
  "agent.card.confirm": "Confirm",
  "agent.card.confirmAll": "Confirm all {count} steps",
  "agent.card.cancel": "Cancel",
  "agent.card.stop": "Stop after this step",
  "agent.card.stopping": "Stopping after this step",
  "agent.card.openScreen": "Open the screen",
  "agent.card.expiresIn.one": "Expires in 1 minute",
  "agent.card.expiresIn.other": "Expires in {count} minutes",
  "agent.card.expiredAsk": "Expired - ask again",
  "agent.card.handOffHint":
    "This step finishes on the screen itself. Confirm opens that control with these values filled in.",

  "agent.card.result.done": "Done. All {count} steps ran, confirmed by you.",
  "agent.card.result.stopped": "Stopped at step {step}. {ran} of {count} ran; nothing was retried.",
  "agent.card.result.stoppedByYou": "Stopped by you. {ran} of {count} ran.",
  "agent.card.result.held": "Held at step {step} for a second approver. {ran} of {count} ran.",
  "agent.card.result.cancelled": "Cancelled by you. Nothing was sent.",
  "agent.card.result.expired": "Expired. Ask again for a fresh proposal.",
  "agent.card.live.running": "Step {step} of {count} running",

  "agent.card.note.unresolvedReference": "This step needed a value an earlier step did not report.",
  "agent.card.note.unreachable": "The request did not reach the server.",
  "agent.card.note.stale": "This proposal is more than ten minutes old.",
  "agent.card.note.notWired": "This screen's control is not wired to the assistant yet.",
  "agent.card.note.noBuilder":
    "This draft can only be applied from the form's own screen, with the builder open.",
  "agent.card.note.unknownRole": "That is not a role this workspace's member rows can carry.",
  "agent.card.note.noDraftToPublish":
    "There is no draft to publish into that environment any more. Read the form again and ask for a fresh proposal.",

  /** The marker links to the existing card and must never become another Confirm action. */
  "agent.marker.text": "proposed · Review",
  "agent.marker.description":
    "Moves focus to the assistant's card for {summary}. Nothing runs from here.",

  "agent.launcher.toReview": "1 action to review",

  /** Never expose provider messages, error codes, URLs or keys; retry guidance comes from the upstream retryability classification. */
  "forms.assist.error.PROVIDER_ERROR": "The assistant is unavailable right now. Try again shortly.",
  "forms.assist.error.PROVIDER_REJECTED":
    "The model provider refused this request, and trying again will not help. Check the provider account and the assistant settings for this deployment.",

  "forms.assist.error.NO_PROPOSAL":
    "This reply has no proposal, so there is nothing to accept. To get one, describe a change to this form's steps, questions or rules.",
  "forms.assist.error.REFUSED": "The assistant declined that request. {message}",
  "forms.assist.error.LENGTH":
    "The assistant's reply was cut off before it could finish. Try again.",
  "forms.assist.error.STEP_LIMIT":
    "The assistant reached its step limit for this turn without finishing. Try a smaller change.",
  "forms.assist.error.TOOL_REJECTED":
    "The assistant tried an action it is not allowed to take, and it was refused. {tool}",
  "forms.assist.error.RATE_LIMITED": "Too many requests. Try again in a moment.",
  "forms.assist.error.RATE_LIMITED_RETRY": "Too many requests. Try again in {seconds}s.",
  "forms.assist.error.STALE_DRAFT":
    "This draft changed since the conversation started. Reload the builder and try again.",
  "forms.assist.error.HTTP": "That request did not reach the assistant. {message}",

  "forms.assist.provenance": "draft includes agent-assisted changes",

  /** Erasure copy states irreversible answer deletion and retained tombstones without claiming recall from consumers. Webhook secrets are revealed only once and cannot be recovered. */

  "forms.tab.responses": "Responses",
  "forms.tab.webhooks": "Webhooks",

  "ops.common.none": "-",

  "ops.common.yourZone": "your time zone",
  "ops.common.cancel": "Cancel",
  "ops.common.working": "Working…",
  "ops.common.copy": "Copy",
  "ops.common.copied": "Copied to the clipboard.",
  "ops.common.copyFailed": "That could not be copied. Select the text and copy it manually.",

  "ops.area.responses.formsFailed": "The form list could not be loaded. {message}",

  "ops.area.webhooks.title": "Webhook operations",

  "ops.area.webhooks.intro":
    "The dead-letter queue below covers every form. Endpoints are configured per form, on that form's Webhooks screen - open one from the list below.",

  "ops.area.webhooks.pickForm": "Configure webhooks for {slug}",
  "ops.area.webhooks.noForms": "No forms exist yet, so there is nothing to deliver.",
  "ops.area.webhooks.filter.form": "Form",
  "ops.area.webhooks.filter.formAll": "Any form",

  "ops.responses.heading": "Responses",
  "ops.responses.filters": "Filters",
  "ops.responses.filter.version": "Version",
  "ops.responses.filter.anyVersion": "Any version",
  "ops.responses.filter.from": "Submitted from",
  "ops.responses.filter.to": "Submitted to",
  "ops.responses.filter.flagged": "Flagged",
  "ops.responses.filter.anyFlag": "Any",
  "ops.responses.filter.onlyFlagged": "Flagged only",
  "ops.responses.filter.onlyClean": "Not flagged",
  "ops.responses.filter.apply": "Apply filters",
  "ops.responses.filter.clear": "Clear filters",

  "ops.responses.filter.dayHint": "Whole days, in {zone}.",
  /** Name ignored malformed filters so an unfiltered total cannot masquerade as the requested date range. */
  "ops.responses.filter.ignored.one":
    "One filter was not applied: the address set {fields} to a value it does not accept.",
  "ops.responses.filter.ignored.other":
    "{count} filters were not applied: the address set {fields} to values they do not accept.",
  "ops.responses.table": "Submitted responses",
  "ops.responses.column.sessionId": "Session",
  "ops.responses.column.version": "Version",
  "ops.responses.column.submittedAt": "Submitted",
  "ops.responses.column.access": "Access",
  "ops.responses.column.flag": "Flag",
  /** Clipped values and omitted answers need separate translation keys even when English renders the same marker. */
  "ops.responses.column.preview": "Answer preview",
  "ops.responses.preview.pair": "{question}: {value}",
  "ops.responses.preview.separator": " · ",
  "ops.responses.preview.clipped": "{value}…",
  "ops.responses.preview.more": "…",
  "ops.responses.preview.none": "No answers",
  "ops.responses.access.anonymous": "Anonymous",
  "ops.responses.access.secure_link": "Secure link",
  "ops.responses.flag.clean": "Not flagged",
  "ops.responses.flag.flagged": "Flagged",
  "ops.responses.reason.HONEYPOT": "Honeypot field was filled",
  "ops.responses.reason.MIN_TIME": "Submitted faster than the minimum time",
  "ops.responses.reason.RATE_ANOMALY": "Unusual submission rate",
  "ops.responses.reason.unknown": "Flagged as {reason}",

  "ops.responses.emptyTitle": "No responses yet",
  "ops.responses.empty": "Nothing has been submitted to this form yet.",
  "ops.responses.filteredEmpty": "No response matches these filters.",
  "ops.responses.total.one": "1 response",
  "ops.responses.total.other": "{count} responses",
  "ops.responses.pageOf": "Page {page} of {pages}",
  "ops.responses.previous": "Previous page",
  "ops.responses.next": "Next page",
  /** The accessible name must include the painted abbreviation for speech input and the complete ID for unambiguous identification. */
  "ops.responses.open": "{shownId}, open response {sessionId}",
  "ops.responses.listFailed": "The responses could not be loaded. {message}",

  "ops.export.open": "Export",
  "ops.export.title": "Export responses",
  "ops.export.format": "Format",
  "ops.export.csv": "CSV",
  "ops.export.json": "JSON",
  "ops.export.version": "Version",
  "ops.export.pickVersion": "Choose a version",
  "ops.export.versionRequired":
    "CSV has one column per question of a single version, so a version is required.",
  "ops.export.versionIgnored": "JSON records carry their own version, so no version is needed.",
  /** Wide CSV headers depend on the frozen version maximum; consumers need a pinned version. Long shape avoids that changing-width contract. */
  "ops.export.shape": "CSV shape",
  "ops.export.shapeLong": "Long (default)",
  "ops.export.shapeWide": "Wide",
  "ops.export.shapeLongHint":
    "One file per repeating group beside the main file, downloaded together as a zip when this form has a group. The columns are the questions, so the header does not change when a later version allows more instances.",
  "ops.export.shapeWideHint":
    "One flat file, with a repeating group's answers in numbered columns such as q_passport__1. The number of columns is the maximum this version allows, not the number anybody answered, so a later version that raises that maximum has more columns. Pin the version your pipeline reads.",
  "ops.export.shapeIgnored":
    "JSON carries repeated answers inside each record, so it has one shape.",
  "ops.export.from": "Submitted from",
  "ops.export.to": "Submitted to",
  "ops.export.dayHint": "Whole days, in {zone}.",
  "ops.export.download": "Download",
  "ops.export.noVersions": "This form has no published version, so there is nothing to export.",
  /** Empty CSV contains a header; empty JSON is an empty array. State the selected format rather than promising one shape for both. */
  "ops.export.emptyNote.csv":
    "A CSV export that matches nothing downloads as a file with only its header row.",
  "ops.export.emptyNote.json": "A JSON export that matches nothing downloads as an empty list.",

  "ops.detail.heading": "Response {sessionId}",
  "ops.detail.back": "Back to responses",
  "ops.detail.answers": "Locked answers",
  "ops.detail.answersIntro":
    "The answers as submitted, captioned with the wording of the question version this form version pinned.",
  "ops.detail.ledger": "Answer ledger",
  "ops.detail.ledgerIntro":
    "Every revision, oldest first. Answers are append-only, so a change adds an entry and never rewrites one.",
  "ops.detail.ledgerEmpty": "This session has no recorded revisions.",
  "ops.detail.ledgerRetracted": "cleared",
  "ops.detail.ledgerAnswered": "answered",
  "ops.detail.submittedAt": "Submitted",
  "ops.detail.version": "Form version",
  "ops.detail.access": "Access",
  "ops.detail.contentHash": "Content hash",
  "ops.detail.contentHashHint":
    "The audit anchor: re-deriving it from the locked answers proves they have not changed.",
  "ops.detail.noAnswer": "Not answered",
  "ops.detail.emptyAnswer": "Answered with an empty value",

  "ops.detail.secureLinkNote":
    "This response came in through a secure link. Link lifecycle is on the form's Links screen.",
  "ops.detail.secureLinkGo": "Open the Links screen",
  "ops.detail.flagged": "Flagged: {reason}",
  "ops.detail.flaggedNote":
    "The response is stored, and its webhook event is withheld until it is released.",
  "ops.detail.unflag": "Release the withheld event",
  "ops.detail.unflagTitle": "Release this response to webhook consumers?",
  "ops.detail.unflagBody":
    "The withheld response.submitted event is queued for delivery. Once a consumer has it, it cannot be recalled.",
  "ops.detail.confirmUnflag": "Release it",
  "ops.detail.unflagged": "The withheld event is queued for delivery.",
  "ops.detail.unflagNoop": "There was no withheld event to release.",
  "ops.detail.unflagFailed": "The event was not released. {message}",
  "ops.detail.loadFailed": "This response could not be loaded. {message}",
  "ops.detail.labelsFailed":
    "Question wording could not be loaded, so answers are captioned with their question ids.",

  "ops.erase.button": "Erase respondent data…",
  "ops.erase.title": "Erase this respondent's data?",
  "ops.erase.irreversible":
    "This deletes every answer and the submission for this session. There is no undo: no soft delete, and nothing this screen can restore from.",
  "ops.erase.tombstoneStays":
    "A tombstone remains - the session id, the form, the version, when it was erased and why. That is the compliance record, and it holds no answers.",
  /** Delivered events belong to the consumer. Erasure cancels undelivered events and redacts retained outbox answers; copy must not imply they may still send. */
  "ops.erase.consumersUnaffected":
    "An event already delivered stays delivered: that copy is the consumer's to erase, as an independent data controller. An event for this session that has not been delivered is cancelled and will never be sent. QCMS's own stored copy of the answers, in the queued event, is redacted.",
  "ops.erase.reason": "Reason",
  "ops.erase.reason.subject_request": "Data subject request",
  "ops.erase.reason.retention_policy": "Retention policy",
  "ops.erase.reason.operator_error": "Entered in error",
  "ops.erase.confirmLabel": "Type the session id to confirm",
  "ops.erase.confirmHint": "Type {sessionId} exactly.",
  "ops.erase.mismatch": "That does not match the session id, so erasure is still blocked.",
  "ops.erase.confirm": "Erase permanently",
  "ops.erase.done": "The respondent data for {sessionId} has been erased.",
  "ops.erase.alreadyErased": "That session was already erased. Nothing changed.",
  "ops.erase.failed": "Nothing was erased. {message}",

  /** Cross-environment erasure is a navigation offer, never an automatic action or a claim that erasure already occurred. */
  "ops.erase.elsewhere.title": "This session id also exists in another environment",
  "ops.erase.elsewhere.body":
    "An erasure acts in the environment you are looking at and in no other, so nothing here has been erased anywhere else. To finish a data subject's request, go to each environment below and erase there. Each one asks you to confirm again, and names its own environment when it does.",
  "ops.erase.elsewhere.go": "Go to {environment}",
  "ops.erase.elsewhere.done": "{environment}: already erased there",
  "ops.erase.elsewhere.pending": "{environment}: not erased there yet",

  "ops.tombstone.title": "Erased",
  "ops.tombstone.body":
    "This session's answers were erased. What remains is the tombstone below (ADR-17).",
  "ops.tombstone.sessionId": "Session",
  "ops.tombstone.formVersion": "Form version",
  "ops.tombstone.erasedAt": "Erased",
  "ops.tombstone.reason": "Reason",
  /** Quote unfamiliar stored reasons inside catalog prose; never present raw database tokens as authored sentences. */
  "ops.erase.reason.unknown": "Recorded as {reason}",

  "ops.erasures.title": "Erasure log",
  "ops.erasures.intro":
    "Every erasure, newest first. A row is the evidence that a session existed and was erased; it holds no answers.",
  "ops.erasures.table": "Erasure tombstones",
  "ops.erasures.column.sessionId": "Session",
  "ops.erasures.column.formId": "Form",
  "ops.erasures.column.formVersion": "Version",
  "ops.erasures.column.erasedAt": "Erased",
  "ops.erasures.column.reason": "Reason",
  "ops.erasures.emptyTitle": "No erasures recorded",
  "ops.erasures.empty": "Nothing has been erased.",
  "ops.erasures.total.one": "1 erasure",
  "ops.erasures.total.other": "{count} erasures",
  "ops.erasures.loadFailed": "The erasure log could not be loaded. {message}",

  "ops.webhooks.heading": "Webhook endpoints",
  /** Flagged submissions withhold webhook events until explicit unflagging; never promise delivery for every submission. */
  "ops.webhooks.intro":
    "Each active endpoint receives a signed response.submitted request for every submission except a flagged one, whose event is withheld until an operator releases it on the response.",
  "ops.webhooks.add": "Add endpoint",
  "ops.webhooks.addTitle": "Add a webhook endpoint",
  "ops.webhooks.url": "Endpoint URL",
  "ops.webhooks.urlHint": "https, unless this deployment allows private targets.",
  "ops.webhooks.activeNow": "Deliver to it straight away",
  "ops.webhooks.create": "Create endpoint",
  "ops.webhooks.table": "Configured endpoints",
  "ops.webhooks.column.webhookId": "Endpoint",
  "ops.webhooks.column.url": "URL",
  "ops.webhooks.column.state": "State",
  "ops.webhooks.column.secret": "Secret",
  "ops.webhooks.column.createdAt": "Created",
  "ops.webhooks.column.actions": "Actions",
  "ops.webhooks.state.active": "Active",
  "ops.webhooks.state.inactive": "Inactive",
  "ops.webhooks.secretStored": "Stored, not retrievable",
  "ops.webhooks.emptyTitle": "No endpoint yet",
  "ops.webhooks.empty": "This form has no webhook endpoint configured.",
  "ops.webhooks.createFailed": "The endpoint was not created. {message}",
  "ops.webhooks.listFailed": "The endpoints could not be loaded. {message}",
  "ops.webhooks.secretTitle": "Copy this secret now",
  "ops.webhooks.secretOnce":
    "This is the only time this secret is shown. The server keeps it encrypted and has no way to show it again; if it is lost, rotate to a new one.",
  "ops.webhooks.secretLabel": "Signing secret for {webhookId}",
  /** Missing create/rotate secrets indicate a contract failure; show the recovery rather than an empty reveal. */
  "ops.webhooks.secretMissing":
    "The server returned no secret for this endpoint. Rotate the secret to get one.",
  "ops.webhooks.secretDismiss": "I have copied it",
  "ops.webhooks.rotate": "Rotate secret",
  "ops.webhooks.rotateTitle": "Rotate this endpoint's secret?",
  "ops.webhooks.rotateBody":
    "The next delivery is signed with the new secret, so a consumer still verifying with the old one starts rejecting. The new secret is shown once.",
  "ops.webhooks.confirmRotate": "Rotate it",
  "ops.webhooks.rotateFailed": "The secret was not rotated. {message}",
  "ops.webhooks.deactivate": "Deactivate",
  "ops.webhooks.deactivateTitle": "Stop delivering to this endpoint?",
  "ops.webhooks.deactivateBody":
    "New submissions stop fanning out to it. Its history stays readable, and deliveries already queued keep their own retry state.",
  "ops.webhooks.confirmDeactivate": "Deactivate it",
  "ops.webhooks.deactivateFailed": "The endpoint was not deactivated. {message}",
  "ops.webhooks.reactivate": "Reactivate",
  "ops.webhooks.reactivateFailed": "The endpoint was not reactivated. {message}",
  "ops.webhooks.retarget": "Change URL",
  "ops.webhooks.retargetTitle": "Point this endpoint somewhere else",
  "ops.webhooks.retargetBody":
    "Deliveries already queued for this endpoint go to the new URL on their next attempt, including redelivered ones.",
  "ops.webhooks.confirmRetarget": "Save the URL",
  "ops.webhooks.retargetFailed": "The URL was not changed. {message}",

  /** Distinguish applied production changes from changes waiting for a second account; retrying alone cannot clear approval refusals. */
  "ops.error.proposerCannotConfirm":
    "You proposed this change, so you cannot confirm it. Another approver who holds production in scope has to.",
  "ops.error.endpointChangePending":
    "This endpoint already has a change waiting for approval. Confirm or withdraw that one first.",
  "ops.error.endpointProposalNotFound":
    "That change is no longer waiting in this environment. Reload the screen to see what is pending.",
  "ops.error.endpointProposalNotPending":
    "That change has already been confirmed or withdrawn. Reload the screen to see where it got to.",
  "ops.proposals.stored":
    "Saved as a change waiting for approval. Nothing has changed in {environment} yet: a different approver has to confirm it before the endpoint moves.",
  "ops.proposals.heading": "Changes waiting for approval",
  "ops.proposals.intro":
    "This workspace requires a second approver for production. Each change below has taken effect on nothing: the endpoint still delivers exactly as it did. An approver other than the one who proposed it can confirm it, and either of them can withdraw it.",
  "ops.proposals.table": "Endpoint changes waiting for approval",
  "ops.proposals.column.endpoint": "Endpoint",
  "ops.proposals.column.change": "Proposed change",
  "ops.proposals.column.proposedBy": "Proposed by",
  "ops.proposals.column.state": "State",
  "ops.proposals.column.actions": "Actions",
  "ops.proposals.kind.create": "Add this endpoint",
  "ops.proposals.kind.update": "Change this endpoint",
  "ops.proposals.kind.deactivate": "Stop delivering to this endpoint",
  "ops.proposals.rotates": "Confirming this also rotates the signing secret.",
  "ops.proposals.state.waiting": "Waiting for a second approver",
  /** Confirmed with no applied write is not live. Retrying completes application without another confirmation. */
  "ops.proposals.state.unapplied": "Confirmed, not yet applied. Confirm again to finish it.",
  "ops.proposals.confirm": "Confirm",
  "ops.proposals.confirmTitle": "Confirm this endpoint change?",
  /** Consequences depend on change kind: deactivation stops delivery, while secret-only updates name no new URL. */
  "ops.proposals.confirmBody.create":
    "A new endpoint in {environment} starts receiving deliveries at {url} as soon as this is confirmed.",
  "ops.proposals.confirmBody.retarget":
    "The endpoint in {environment} starts delivering to {url} as soon as this is confirmed, and stops delivering to its current URL.",
  "ops.proposals.confirmBody.update":
    "The endpoint in {environment} keeps its current URL and takes the rest of this change as soon as it is confirmed.",
  "ops.proposals.confirmBody.deactivate":
    "The endpoint in {environment} stops receiving deliveries as soon as this is confirmed. Its row and its delivery history are kept.",
  "ops.proposals.confirmWarning":
    "You cannot confirm a change you proposed yourself. If this is yours, ask another approver.",
  "ops.proposals.confirmFailed": "That change was not confirmed. {message}",
  "ops.proposals.withdraw": "Withdraw",
  "ops.proposals.withdrawTitle": "Withdraw this endpoint change?",
  "ops.proposals.withdrawBody":
    "The change is discarded and the endpoint in {environment} is left exactly as it is. Proposing it again starts over.",
  /** Withdrawing an unapplied confirmed proposal releases the endpoint for a fresh change; nothing live needs undoing. */
  "ops.proposals.withdrawBodyConfirmed":
    "This change was confirmed and never reached the endpoint, so there is nothing live to undo. Withdrawing it releases the endpoint in {environment} so a new change can be proposed for it.",
  "ops.proposals.withdrawFailed": "That change was not withdrawn. {message}",

  "ops.deliveries.heading": "Recent deliveries",
  "ops.deliveries.intro":
    "One row per event and endpoint. Each row records the most recent attempt made for it.",
  "ops.deliveries.table": "Recent webhook deliveries",
  "ops.deliveries.column.event": "Event",
  "ops.deliveries.column.target": "Endpoint",
  "ops.deliveries.column.status": "Status",
  "ops.deliveries.column.attempts": "Failed attempts",
  "ops.deliveries.column.latency": "Latency",
  "ops.deliveries.column.lastAttempt": "Last attempt",
  "ops.deliveries.status.delivered": "Delivered",
  "ops.deliveries.status.deadLettered": "Dead-lettered",
  "ops.deliveries.status.pending": "Pending",
  "ops.deliveries.status.cancelled": "Cancelled",
  /** Keep cancelled deliveries visible with a reason so disappearance cannot hide their outcome. */
  "ops.deliveries.cancelled.session_erased":
    "Cancelled: the respondent's data was erased, so this event was never sent and its stored copy of the answers has been redacted.",
  "ops.deliveries.cancelled.unknown": "Cancelled. Recorded reason: {reason}.",
  "ops.deliveries.cancelledAt": "Cancelled",
  "ops.deliveries.attemptsHint":
    "Attempts that failed. A delivery that succeeded first time shows zero.",
  "ops.deliveries.latency": "{ms} ms",
  /** Redelivery clears the whole last-attempt record; absence does not prove a delivery was never tried. */
  "ops.deliveries.noAttempt":
    "No attempt on record: nothing has been sent since this delivery was queued. Redelivering clears the previous attempt, so a row queued again reads the same as one never tried.",
  "ops.deliveries.showDetail": "Show request and response for {event}",
  "ops.deliveries.hideDetail": "Hide request and response for {event}",

  "ops.deliveries.digest": "{status}, {attempts}",
  "ops.deliveries.digest.withLatency": "{status}, {attempts}, {latency}",
  "ops.deliveries.digest.attemptOne": "1 failed attempt",
  "ops.deliveries.digest.attemptOther": "{count} failed attempts",
  "ops.deliveries.attemptSummary": "This delivery",
  "ops.deliveries.requestHeaders": "Request headers",
  "ops.deliveries.signatureMasked":
    "The signature is masked before it is stored, so this record never held the HMAC.",
  "ops.deliveries.responseCode": "Response code",
  /** The API exposes only a bounded stored prefix; do not promise a length this app cannot verify. */
  "ops.deliveries.responseBody": "Response body (stored prefix)",
  "ops.deliveries.noResponse": "No response arrived: {error}",
  "ops.deliveries.emptyBody": "The response body was empty.",
  /** Erasure and retention both remove snippets; cause-free wording remains true for both. */
  "ops.deliveries.redactedBody": "The stored response body was removed on {when}.",
  "ops.deliveries.lastError": "Last error",
  "ops.deliveries.emptyTitle": "No deliveries yet",
  "ops.deliveries.empty": "Nothing has been delivered for this form yet.",
  "ops.deliveries.loadFailed": "The deliveries could not be loaded. {message}",

  "ops.deadLetters.heading": "Dead-letter queue",
  "ops.deadLetters.intro":
    "Deliveries that exhausted their retries. Fix the target, then redeliver: a redelivered item is queued for the next delivery pass.",
  "ops.deadLetters.table": "Dead-lettered deliveries",
  "ops.deadLetters.column.event": "Event",
  "ops.deadLetters.column.target": "Endpoint",
  "ops.deadLetters.column.attempts": "Attempts",
  "ops.deadLetters.column.lastError": "Last error",
  "ops.deadLetters.column.deadLetteredAt": "Dead-lettered",
  "ops.deadLetters.emptyTitle": "Nothing dead-lettered",
  "ops.deadLetters.empty": "The dead-letter queue is empty.",
  "ops.deadLetters.total.one": "1 dead-lettered delivery",
  "ops.deadLetters.total.other": "{count} dead-lettered deliveries",
  "ops.deadLetters.redeliver": "Redeliver",
  "ops.deadLetters.redeliverOne": "Redeliver {event} to {target}",
  "ops.deadLetters.redeliverAll": "Redeliver all",
  "ops.deadLetters.redeliverAllTitle": "Redeliver every dead-lettered delivery?",
  "ops.deadLetters.redeliverAllBody":
    "Each one is reset to due now and re-attempted on the next delivery pass. A target that is still broken dead-letters again.",
  "ops.deadLetters.confirmRedeliverAll": "Redeliver all of them",
  "ops.deadLetters.queued.one": "1 delivery is queued for the next pass.",
  "ops.deadLetters.queued.other": "{count} deliveries are queued for the next pass.",
  "ops.deadLetters.redeliverFailed": "Nothing was redelivered. {message}",
  "ops.deadLetters.redeliverPartial":
    "{queued} queued, {failed} refused. The refused ones are still in the queue below.",
  "ops.deadLetters.loadFailed": "The dead-letter queue could not be loaded. {message}",

  "ops.error.invalidQuery": "One of those filters is not a value the server accepts.",
  "ops.error.invalidSessionId": "That is not a valid session id.",
  "ops.error.responseNotFound": "There is no such response for this form. It may have been erased.",
  "ops.error.sessionNotFound": "There is no such session.",
  "ops.error.submissionNotFound": "That session has not been submitted.",
  "ops.error.webhookNotFound": "That endpoint no longer exists for this form.",
  /** Describe the deployment target policy without naming flags: private targets may be allowed by operator configuration. */
  "ops.error.webhookUrlRejected":
    "That URL was refused. A webhook target must be an absolute URL, and unless this deployment allows private targets it must also use https and must not point at a private or reserved address.",
  /** Select catalog copy only from closed SSRF reason codes. Never echo API error messages or expose deployment flag values; unknown reasons use general copy. */
  "ops.error.webhookUrlNotAbsolute":
    "That URL was refused. A webhook target must be a complete, absolute URL with a scheme and a host.",
  "ops.error.webhookUrlScheme": "That URL was refused. A webhook target must use http or https.",
  "ops.error.webhookUrlHttpsRequired":
    "That URL was refused. This deployment delivers to https targets only.",
  "ops.error.webhookUrlPrivateHost":
    "That URL was refused. It points at a private or reserved address, which this deployment does not deliver to.",
  "ops.error.deliveryNotFound": "That delivery no longer exists.",
  /** Never render thrown values: transport errors can carry URLs, headers or body fragments. */
  "ops.error.unexpected":
    "That did not reach the server, so nothing changed. Check the connection and try again.",
  /** Missing retained payload can result from erasure races or ordinary retention expiry. Both must refuse redelivery; do not narrow the message to erasure. */
  "ops.error.deliveryNotRedeliverable":
    "The response that delivery carries is no longer held, so it will not be re-sent.",
  /** Validate closed erasure reasons before recording them on tombstones that outlive respondent data. */
  "ops.error.invalidErasureReason":
    "That erasure reason is not one this build records, so nothing was erased.",

  "forms.rail.steps": "Steps",
  "forms.rail.formMenu": "Actions for {title}",
  "forms.rail.sections": "Sections",

  "forms.rail.stepPosition": "{position}.",

  /** Test response grants are grants on personal data, including real respondents. Access-group names are labels; role and scope fields alone authorize. */
  "membership.area.title": "Workspaces",
  "membership.area.intro":
    "A workspace owns forms and questions, and its membership is what authorises work on them. A grant is a role and its scope, and a person holds as many grants as their job needs.",
  "membership.area.noWorkspaces":
    "You manage no workspace. Your own grants are on the access panel below.",
  "membership.area.loadFailed": "The workspaces could not be read: {message}",
  "membership.area.shared": "Shared question library",
  "membership.area.archived": "Archived",
  "membership.area.twoPerson": "Second approver required",
  "membership.area.counts": "{forms} form(s), {questions} question(s)",
  "membership.workspace.title": "{name}",
  "membership.workspace.notFound": "No such workspace, or you do not manage it.",
  "membership.workspace.allWorkspaces": "All workspaces",

  "membership.members.heading": "Members",
  "membership.members.intro":
    "Who is a member of this workspace, and which access groups each one holds. Only this workspace's owners and the holder of the installation-wide claim can read this list.",
  "membership.members.loadFailed": "The membership list could not be read: {message}",
  "membership.members.none": "This workspace has no members yet.",

  "membership.members.table": "Members of this workspace and the access groups each holds",
  "membership.audit.table": "The access audit for this workspace, newest first",
  "membership.members.columnEmail": "Account",
  "membership.members.columnRole": "Member row",
  "membership.members.columnGroups": "Access groups",
  "membership.members.noGroups": "None",

  "membership.members.emptyRole": "Member (grants nothing on its own)",
  "membership.members.ownerRole": "Workspace owner",
  "membership.members.makeOwner": "Make a workspace owner",
  "membership.members.removeOwner": "Remove workspace owner",
  "membership.members.roleChanged": "The member row is now {role}.",
  "membership.members.roleFailed": "The member row was not changed: {message}",

  "membership.groups.heading": "Access groups",
  "membership.groups.intro":
    "One group is one grant: a role and its scope. Team membership is the grant, so a group with no holders grants nobody anything.",
  "membership.groups.loadFailed": "The access groups could not be read: {message}",
  "membership.groups.none": "This workspace has no access groups yet.",
  "membership.groups.nameHelp":
    "A name is written <environments>.<role>[.<label>] and is a label rather than a mechanism: the role and the scope on the group decide what it grants, and a name out of step with them is refused on save. Nothing reads a name to authorise anything.",
  "membership.groups.derivedName": "Full name {fullName}, in a directory {directoryName}",
  "membership.groups.columnRole": "Role",
  "membership.groups.columnEnvironments": "Environments",
  "membership.groups.columnForms": "Forms",
  "membership.groups.columnHolders": "Holders",
  "membership.groups.create": "Create an access group",
  "membership.groups.createName": "Name",
  "membership.groups.createRole": "Role",
  "membership.groups.createEnvironments": "Environments",
  "membership.groups.createForms": "Forms (one id per line, or `all`)",
  "membership.groups.createLabel": "Label (optional)",
  "membership.groups.createSubmit": "Create group",
  "membership.groups.created":
    "The access group {name} was created. It grants nobody anything until somebody holds it.",
  "membership.groups.createFailed": "The access group was not created: {message}",
  "membership.groups.remove": "Remove group",
  "membership.groups.removed":
    "The group and every grant it carried were removed, and each removal is on the access audit.",
  "membership.groups.removeFailed": "The group was not removed: {message}",
  "membership.groups.addHolderEmail": "Account address",
  "membership.groups.addHolderSubmit": "Grant",
  "membership.groups.holderAdded": "{email} now holds {name}.",
  "membership.groups.holderFailed": "The grant was not written: {message}",
  "membership.groups.removeHolder": "Revoke",
  /** The accessible revoke name includes its visible word and holder email; keep the email out of the painted button to preserve narrow layouts. */
  "membership.groups.removeHolderFor": "Revoke this access group from {email}",
  "membership.groups.holderRemoved":
    "The grant was revoked, and the revoke is on the access audit.",
  "membership.groups.noHolders": "Nobody",

  "membership.settings.heading": "Workspace settings",
  "membership.settings.twoPerson": "Require a second approver for production",
  "membership.settings.twoPersonHelp":
    "One switch, three effects. A release to production is refused for the account that published the version; a production endpoint change takes a second approver's confirmation; and nobody can grant themselves a responses role - a second workspace owner, or the holder of the installation-wide claim, has to make that grant. Off by default, because an installation with one account cannot satisfy the rule at all.",
  "membership.settings.seed": "Seed a new editor with dev and test response access",

  "membership.settings.seedHelp":
    "A grant on test responses is a grant on personal data, because a test run can involve real respondents. With this on, onboarding a forms.editor also grants them a responses.viewer role on dev and test - an ordinary access group you can see in the list above and revoke. Off by default, and turning it on is written to the access audit.",
  "membership.settings.save": "Save settings",
  "membership.settings.saved": "The settings were saved, and the change is on the access audit.",
  "membership.settings.saveFailed": "The settings were not saved: {message}",

  "membership.audit.heading": "Access audit",
  "membership.audit.intro":
    "Every response read, export and erasure, every grant and revoke, and every change to the settings above. It records the act and not its subject matter: no answer value, no respondent identifier and no question text.",
  "membership.audit.loadFailed": "The access audit could not be read: {message}",
  "membership.audit.none": "Nothing has been recorded in this workspace yet.",
  "membership.audit.columnWhen": "When",
  "membership.audit.columnActor": "Account",
  "membership.audit.columnKind": "Act",
  "membership.audit.columnEnvironment": "Environment",
  "membership.audit.columnForm": "Form",
  "membership.audit.columnDetail": "Detail",
  "membership.audit.empty": "-",
  "membership.audit.total": "{total} row(s)",
  /** Audit records must survive account deletion and fall back to account IDs rather than cascading away. */
  "membership.audit.unknownActor": "{actor} (account removed)",

  "membership.agentAudit.heading": "Assistant actions",
  "membership.agentAudit.intro":
    "Every step the assistant proposed and a person confirmed, newest first. Each step ran as the person who confirmed it, through the screen's own control, and each row records the act and not its subject matter.",
  "membership.agentAudit.loadFailed": "The assistant actions could not be read: {message}",
  "membership.agentAudit.none": "The assistant has confirmed nothing in this workspace yet.",
  "membership.agentAudit.table":
    "The steps the assistant proposed and a person confirmed in this workspace, newest first",
  "membership.agentAudit.columnWhen": "Confirmed",
  "membership.agentAudit.columnActor": "Account",
  "membership.agentAudit.columnKind": "Action",
  "membership.agentAudit.columnStep": "Step",
  "membership.agentAudit.columnScreen": "Screen",
  "membership.agentAudit.columnEnvironment": "Environment",
  "membership.agentAudit.columnForm": "Form",
  "membership.agentAudit.columnDetail": "Detail",
  "membership.agentAudit.empty": "-",
  "membership.agentAudit.total": "{total} step(s)",
  "membership.agentAudit.step": "{index} of {count}",
  "membership.agentAudit.unknownActor": "{actor} (account removed)",

  "membership.mine.heading": "Your own access",
  "membership.mine.intro":
    "Which workspaces, roles, environments and forms you hold. Everybody can read their own grants; the membership list of a workspace is its owners' to see.",
  "membership.mine.loadFailed": "Your access could not be read: {message}",
  "membership.mine.installationAdmin":
    "You hold the installation-wide claim: settings, accounts, memberships and environments, in every workspace. It grants no response read, export or erasure anywhere.",
  "membership.mine.none": "You hold no grant in any workspace.",
  "membership.mine.memberOnly": "A member row that grants nothing on its own",
  "membership.mine.environments": "Environments: {environments}",
} as const;

export type MessageKey = keyof typeof messages;

/** Pass both typed plural keys so missing forms fail at build time. Locales with more forms need a wider Intl.PluralRules selection here. */
export function tPlural(
  one: MessageKey,
  other: MessageKey,
  count: number,
  params?: Readonly<Record<string, string | number>>,
): string {
  return t(count === 1 ? one : other, { ...params, count });
}

export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template: string = messages[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
