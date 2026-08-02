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

  // ---------------------------------------------------------------------------
  // The form builder and condition editor (task 033).
  //
  // Four rules the wording teaches, stated once here rather than argued in each
  // string. Every sentence below that touches one of them is written to make the
  // rule obvious at the moment an author meets it, because these are the rules
  // that make a questionnaire engine trustworthy and the UI is where they are
  // learned (ADR-02).
  //
  // 1. **A pin is manual, always (R6/R7).** Every reference shows
  //    `questionId@version`, a moved pin moves one pin, and publishing question v3
  //    changes nothing about a form pinned to v2. There is no auto-upgrade and no
  //    bulk move, and the copy says so rather than leaving the absence to be
  //    discovered.
  // 2. **Evaluation is one forward pass (ADR-16).** A rule can only show something
  //    that comes *after* every question its condition reads. Ineligible targets
  //    stay selectable so the mistake can be made and explained, and the sentences
  //    name the reason rather than reporting a refusal.
  // 3. **Set equality is not containment (ADR-21).** On a multiple-choice question
  //    `equals` compares the whole answer, and `contains` / `containsAny` are the
  //    membership tests. The operator names say which is which.
  // 4. **A challenge is a deployment capability (ADR-24).** Requiring one on a form
  //    does nothing while the deployment's provider is `none`, so the panel says
  //    that out loud instead of showing a switch that promises protection it
  //    cannot deliver.
  // ---------------------------------------------------------------------------
  "forms.title": "Forms",
  "forms.intro": "Compose published questions into steps, and branch between them with rules.",
  "forms.new": "New form",
  "forms.backToList": "Back to forms",

  "forms.table.label": "Form library",
  "forms.table.hint": "Open a form with Enter, or by clicking its row.",
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

  "forms.empty.title": "No forms yet",
  "forms.empty.body":
    "Create the first form, then pin published questions into its steps. A question has to be published before a form can pin it.",

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
  "forms.create.idPreview": "This form will be created as {formId}, permanently.",

  "forms.builder.crumbs": "Forms",
  "forms.builder.crumbBuilder": "Builder",
  "forms.builder.crumbLabel": "Breadcrumb",
  "forms.builder.heading": "{slug}",
  "forms.builder.formId": "Form ID",
  "forms.builder.locale": "Default locale",
  "forms.builder.status": "Status",
  "forms.builder.draftSource.open": "Editing the saved draft.",
  "forms.builder.draftSource.seeded":
    "Started from the newest published version. Nothing is stored until the first save.",
  "forms.builder.draftSource.none": "Nothing has been drafted or published for this form yet.",
  "forms.builder.formTitle": "Form title",
  "forms.builder.formTitleHint": "Shown to a respondent. Saved with the draft.",
  "forms.builder.publish": "Publish",
  "forms.builder.publishNote": "Publishing is task 034. A draft with issues cannot be published.",
  "forms.builder.seeded":
    "This draft was started from the newest published version and has not been saved yet. Your first change stores it.",
  "forms.builder.concurrent":
    "Autosave replaces the stored draft outright: if another author has this form open, whichever of you saves last wins and the other's change is gone. There is no locking at launch, so coordinate before editing the same form.",
  "forms.builder.saveFailed": "This draft could not be saved. {message}",
  "forms.builder.closed":
    "This form is closed to new responses. Editing the draft is still allowed; publishing is what makes a change live.",

  "forms.save.idle": "No changes yet.",
  "forms.save.saving": "Saving...",
  "forms.save.saved": "Saved {time}",
  "forms.save.validating": "Checking...",
  "forms.save.failed": "The last save failed.",
  "forms.save.pausedNoSteps":
    "Autosave is paused: a form needs at least one step before it can be stored.",
  "forms.save.pausedEmptyStep":
    "Autosave is paused: every step needs at least one question before the draft can be stored.",
  "forms.save.pausedNoTarget":
    "Autosave is paused: every rule needs at least one question or step to show before the draft can be stored.",

  "forms.validation.title": "Validation",
  "forms.validation.none": "No issues. Everything here would pass a publish.",
  "forms.validation.countOne": "1 issue would block a publish.",
  "forms.validation.count": "{count} issues would block a publish.",
  "forms.validation.checking": "Checking the draft...",

  "forms.steps.title": "Steps",
  "forms.steps.add": "Add step",
  "forms.steps.newTitle": "New step title",
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
  "forms.steps.empty": "No steps yet. Add the first one to start pinning questions.",
  "forms.steps.confirmRemoveTitle": "Remove step {title}?",
  "forms.steps.confirmRemoveBody":
    "The step and its pins go with it. Rules that named the step are left exactly as they are, so a rule pointing at it will be reported as a dangling reference rather than being rewritten for you.",
  "forms.steps.confirmRemove": "Remove step",

  "forms.step.heading": "Step: {title}",
  "forms.step.titleLabel": "Step title",
  "forms.step.pins": "Questions in this step",
  "forms.step.empty": "No questions pinned yet.",
  "forms.step.addQuestion": "Add question from library",
  "forms.step.pinNote":
    "A pin names one frozen version. Publishing a newer version of a question changes nothing here until someone moves this pin by hand (R7).",
  "forms.step.movePin": "Move pin for {questionId}",
  "forms.step.movePinTo": "Move to v{version}",
  "forms.step.movePinNone": "No other published version",
  "forms.step.removePin": "Remove {questionId}",
  "forms.step.pinUp": "Move {questionId} up",
  "forms.step.pinDown": "Move {questionId} down",
  "forms.step.pinDeprecated": "Deprecated version",
  "forms.step.pinDraft": "Unpublished version",
  "forms.step.pinMissing": "Version not found",

  "forms.picker.title": "Add a question to {title}",
  "forms.picker.description":
    "Published versions only. A deprecated version is listed but cannot be pinned, and a question already in this form cannot be pinned twice.",
  "forms.picker.search": "Search",
  "forms.picker.tableLabel": "Question versions",
  "forms.picker.hint": "Choose a row to pin that question at that version.",
  "forms.picker.column.questionId": "Question ID",
  "forms.picker.column.label": "Label",
  "forms.picker.column.type": "Type",
  "forms.picker.column.version": "Version",
  "forms.picker.column.state": "State",
  "forms.picker.statePinnable": "Pinnable",
  "forms.picker.stateDeprecated": "Deprecated",
  "forms.picker.statePinned": "Already in this form",
  "forms.picker.empty": "No published question version matches this search.",
  "forms.picker.close": "Close",

  "forms.rules.title": "Conditions",
  "forms.rules.add": "Add rule",
  "forms.rules.empty": "No rules yet. A rule shows questions or steps when its condition matches.",
  "forms.rules.needPin": "Pin a question first: a condition has to read one.",

  "forms.rule.heading": "Rule {ruleId}",
  "forms.rule.remove": "Remove rule {ruleId}",
  "forms.rule.when": "When",
  "forms.rule.show": "Show",
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
  "forms.rule.backwardWarning":
    "{targets} comes before a question this condition reads. Answers are evaluated in one forward pass, so a rule can only show something that comes later (ADR-16). Publishing will refuse this.",
  "forms.rule.issues": "Issues with this rule",

  "forms.op.answered": "has been answered",
  "forms.op.equals": "equals (the whole answer)",
  "forms.op.notEquals": "does not equal (the whole answer)",
  "forms.op.in": "is one of",
  "forms.op.contains": "includes the option",
  "forms.op.containsAny": "includes any of",
  "forms.op.gt": "is greater than",
  "forms.op.gte": "is greater than or equal to",
  "forms.op.lt": "is less than",
  "forms.op.lte": "is less than or equal to",
  "forms.op.and": "all of",
  "forms.op.or": "any of",
  "forms.op.not": "not",

  "forms.operand.true": "Yes",
  "forms.operand.false": "No",
  "forms.operand.item": "Value {position}",
  "forms.operand.add": "Add value",
  "forms.operand.remove": "Remove value {position}",
  "forms.operand.noOptions": "The pinned version of this question declares no options.",
  "forms.operand.unsupported": "This operator does not apply to this question's type.",

  "forms.json.title": "Condition JSON",
  "forms.json.label": "Condition JSON for rule {ruleId}",
  "forms.json.note":
    "The same condition as the pickers above, in the engine's own DSL. Editing here updates the pickers; the pickers are the primary surface (ADR-19). Autocomplete offers operators, pinned question IDs, and the option IDs of the referenced question's pinned version.",
  "forms.json.parseError":
    "Not valid JSON yet, so the condition above is unchanged. The pickers still hold the last version that parsed.",
  "forms.json.shapeError": "Valid JSON, but not a condition this editor can render.",

  "forms.bench.title": "Rule test bench",
  "forms.bench.note":
    "A read-only preview. Answers typed here are evaluated against the draft on your screen and are never saved, never logged, and never seen by a respondent.",
  "forms.bench.rule": "Rule",
  "forms.bench.answers": "Hypothetical answers",
  "forms.bench.run": "Run preview",
  "forms.bench.noRules": "Add a rule to try it here.",
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

  "forms.settings.title": "Form settings",
  "forms.settings.note": "Abuse controls for this form. They apply the next time it is published.",
  "forms.settings.challengeRequired": "Require a challenge before answering",
  "forms.settings.challengeHint":
    "Starting a session has to pass the deployment's challenge provider first.",
  "forms.settings.challengeUnenforceable":
    "This deployment's challenge provider is set to none, so requiring a challenge here enforces nothing until an operator configures one.",
  "forms.settings.minSubmitDefault": "Use the deployment's minimum time",
  "forms.settings.minSubmit": "Minimum time before a submit is accepted (milliseconds)",
  "forms.settings.minSubmitHint":
    "A submit that arrives faster than this is refused. It exists to make an instant automated post fail, so keep it well under the time a person needs.",
  "forms.settings.save": "Save settings",
  "forms.settings.saved": "Settings saved.",
  "forms.settings.failed": "The settings could not be saved. {message}",

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
    "A rule can only show something that comes after every question its condition reads. Answers are evaluated in one forward pass (ADR-16), so a backward target could never fire.",
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
  "forms.issue.unknown": "The engine reported an issue this screen has no wording for ({code}).",

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
  "forms.error.unknown": "The request failed ({code}).",
  "forms.error.unknownCreate": "The form could not be created. Try again.",
  "forms.error.listFailed": "The form library could not be loaded. {message}",
  "forms.error.libraryFailed": "The question library could not be loaded. {message}",

  // --- publish, preview, version history, secure links (task 034) -----------
  //
  // Two wording constraints run through this whole block and are not stylistic.
  //
  // R1 is taught, never assumed. Publishing, closing and reopening all change what
  // happens to *new* sessions and never to in-flight ones, and an author who does not
  // know that will read "close" as "stop everything". Every one of those three controls
  // says what happens to sessions already under way.
  //
  // A secure-link URL is shown exactly once. The API stores a state row and never the
  // token, so it genuinely cannot be shown again - the copy says so at the moment it
  // matters rather than leaving an operator to discover it.

  "forms.tab.label": "Form sections",
  "forms.tab.builder": "Builder",
  "forms.tab.preview": "Preview",
  "forms.tab.versions": "History",
  "forms.tab.links": "Links",

  "forms.publish.action": "Publish",
  "forms.publish.title": "Publish {slug}?",
  "forms.publish.freezes": "Freezes {steps} steps, {pins} pinned questions, {rules} rules.",
  "forms.publish.sessions":
    "New sessions get v{version}. Sessions already under way finish on the version they started (R1).",
  "forms.publish.immutable":
    "A published version is never edited. Your next change starts a fresh draft, seeded from this one.",
  "forms.publish.confirm": "Publish v{version}",
  "forms.publish.cancel": "Cancel",
  "forms.publish.pending": "Publishing...",
  "forms.publish.noDraft": "There is nothing to publish: this form has no draft.",
  "forms.publish.blocked": "This draft cannot be published yet.",
  "forms.publish.blockedCount": "{count} issues block publishing. Each one links to its cause.",
  "forms.publish.goToIssue": "Go to",
  "forms.publish.published": "Published as v{version}.",
  "forms.publish.viewHistory": "View version history",
  "forms.publish.failed": "The form was not published. {message}",

  "forms.lifecycle.close": "Close form",
  "forms.lifecycle.reopen": "Reopen form",
  "forms.lifecycle.closeTitle": "Close {slug} to new sessions?",
  "forms.lifecycle.closeBody":
    "No one can start this form after it closes. Sessions already under way keep going and finish on the version they pinned (R1); their answers are unaffected.",
  "forms.lifecycle.reopenTitle": "Reopen {slug}?",
  "forms.lifecycle.reopenBody": "New sessions can start again, on the newest published version.",
  "forms.lifecycle.confirmClose": "Close it",
  "forms.lifecycle.confirmReopen": "Reopen it",
  "forms.lifecycle.cancel": "Cancel",
  "forms.lifecycle.pending": "Working...",
  "forms.lifecycle.failed": "The form status did not change. {message}",
  "forms.lifecycle.closedNote":
    "This form is closed. New sessions are refused; in-flight sessions finish normally.",

  "forms.preview.heading": "Preview",
  "forms.preview.banner": "Preview - not published",
  "forms.preview.explain":
    "This is your draft compiled and rendered through the same renderer a respondent uses. Answer the questions to walk your own branches. Nothing here is saved.",
  "forms.preview.stepOf": "Step {index} of {total}: {title}",
  "forms.preview.previous": "Previous step",
  "forms.preview.next": "Next step",
  "forms.preview.reset": "Reset answers",
  "forms.preview.loading": "Compiling the draft...",
  "forms.preview.unavailable": "This draft cannot be previewed yet.",
  "forms.preview.unavailableHint":
    "A preview of a draft that publish would refuse would be a promise about what a respondent sees that publish will not keep. Fix these first.",
  "forms.preview.failed": "The preview could not be loaded. {message}",
  "forms.preview.emptyStep": "Nothing on this step is visible for the answers so far.",
  "forms.preview.noSteps": "This draft has no steps to preview yet.",
  "forms.preview.complete": "Every required question on every visible step is answered.",
  "forms.preview.stamps": "Compiler {compilerVersion} · A2UI spec {a2uiSpecVersion}",

  "forms.history.heading": "Version history",
  "forms.history.intro":
    "Every published version, frozen exactly as it was. Viewing one renders the compiled documents stored at publish time, which is what respondents on that version saw (ADR-18).",
  "forms.history.empty": "This form has never been published.",
  "forms.history.table": "Published versions",
  "forms.history.column.version": "Version",
  "forms.history.column.publishedAt": "Published",
  "forms.history.column.compilerVersion": "Compiler",
  "forms.history.column.a2uiSpecVersion": "A2UI spec",
  "forms.history.column.semanticsVersion": "Semantics",
  "forms.history.view": "View v{version}",
  "forms.history.viewing": "Viewing v{version}",
  "forms.history.stored":
    "Rendered from the compiled documents stored with v{version}. Nothing was recompiled.",
  "forms.history.readOnly": "Read only: a published version is never edited (R1).",
  "forms.history.backToHistory": "Back to version history",
  "forms.history.stepOf": "Step {index} of {total}: {title}",
  "forms.history.failed": "That version could not be loaded. {message}",
  "forms.history.compare": "Compare",
  "forms.history.olderLabel": "Older version",
  "forms.history.newerLabel": "Newer version",
  "forms.history.compareNone": "Pick two versions to compare their definitions.",
  "forms.history.compareHeading": "v{older} compared with v{newer}",
  "forms.history.compareOlder": "v{version} (older)",
  "forms.history.compareNewer": "v{version} (newer)",
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
  "forms.links.mintTitle": "Mint secure links",
  "forms.links.expiresAt": "Expires",
  "forms.links.expiresAtHint": "After this moment the link stops working, used or not.",
  "forms.links.oneTime": "One-time (stops working after the first use)",
  "forms.links.count": "How many",
  "forms.links.countHint": "Up to {max} at a time.",
  "forms.links.confirmMint": "Mint",
  "forms.links.pending": "Minting...",
  "forms.links.cancel": "Cancel",
  "forms.links.mintFailed": "No links were minted. {message}",
  "forms.links.mintedTitle": "{count} links minted",
  "forms.links.mintedOnce":
    "Copy these now. The server stores a link's state, never its token, so these URLs cannot be shown again.",
  "forms.links.copy": "Copy URL",
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
  "forms.links.listFailed": "The links could not be loaded. {message}",

  "forms.error.invalidLinkId": "That is not a valid link.",
  "forms.error.linkNotFound": "That link no longer exists, or it is already revoked.",
  "forms.error.linkExpiryInvalid": "Pick an expiry in the future.",
  "forms.error.invalidLinkBatch": "Ask for between 1 and {max} links.",
  "forms.error.noDraft": "There is no draft to publish.",
  "forms.error.publishRejected": "The draft cannot be published yet. The reasons are listed below.",
  "forms.error.previewRejected": "The draft cannot be previewed yet. The reasons are listed below.",
  "forms.error.versionNotFound": "That version does not exist.",
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
