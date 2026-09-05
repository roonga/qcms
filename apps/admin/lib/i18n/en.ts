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
 *   cannot: they are ciphertext at rest and no route decrypts them for a reader
 *   (issue #319 removed the one that did), so this is their one display.
 *   `settings.recoveryCodes*` offers the only remedy that exists - a fresh set,
 *   which retires the old one - and says so rather than implying a lookup.
 */

export const messages = {
  "app.title": "QCMS",
  "app.description": "Author questionnaires, publish forms, and review responses.",

  // The browser-tab title, one pattern for every route (issue #536). Until this landed,
  // `app/layout.tsx` set a single static `app.title` and no route defined
  // `generateMetadata`, so every screen in the app produced the tab text "QCMS" - and an
  // operator working several responses or several forms side by side, which is how this
  // app is used, could not tell one tab from another at all.
  //
  // Page name FIRST. A tab strip truncates from the right, and the tail is the half every
  // tab shares; leading with "QCMS - " would spend the surviving characters saying the
  // same word on every tab. The app name is kept rather than dropped because a tab is
  // also a browser history entry and a bookmark, where the product name is the context
  // nothing else supplies. `lib/page-title.ts` is the only caller.
  "app.pageTitle": "{page} - QCMS",
  // A form's section screen, for the tab only. The `<h1>` on those screens deliberately
  // says the section alone (Code Owner, 2026-08-26): the breadcrumb above it and the rail
  // beside it both name the form, so composing both there repeated two crumbs a line
  // below them. A tab has no breadcrumb and no rail, so it is the one place the pairing
  // still earns its width - six sibling screens of one form, and several forms open at
  // once, is the exact case that made the sections indistinguishable.
  //
  // `{formId}` rather than `{slug}`: the route knows its `formId` from its own params,
  // and reading the slug would mean a second `GET /admin/forms/{id}` per render purely to
  // name a tab. The id is what the address bar already shows and what R6 makes permanent.
  "title.formSection": "{section}: {formId}",

  "action.skipToContent": "Skip to content",
  "action.signIn": "Sign in",
  "action.signOut": "Sign out",
  "action.verify": "Verify",
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
  "enroll.manualLabel": "Setup key (use this if you cannot scan the code)",
  "enroll.codeLabel": "Six-digit code from your app",

  "recovery.title": "Save your recovery codes",
  "recovery.intro":
    "Each code signs you in once if you lose your authenticator. This is the only time they are shown.",
  "recovery.listLabel": "Recovery codes",
  // The copy control and its status line, worded as both POCs draw them
  // (`plan/admin-shell-poc/auth-poc.html`, `settings-newquestion-poc.html`). The failure
  // sentence names the remedy rather than the cause: an absent clipboard API and a refused
  // write leave the operator with the same thing to do, and "insecure context" is jargon
  // that helps nobody standing in front of ten codes they cannot see again.
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
  // The one change-password failure with a sentence of its own (issue #437, Code Owner
  // ruling 2026-09-03). It names what to do, because unlike every other refusal on this
  // form it can: the password was found in public breach data, so the reader has to pick
  // a different one and no amount of care with the current-password field will help. It
  // says nothing about the account, which is what keeps SEC-1's anti-oracle property
  // intact at the level of the copy; `lib/server/password-refusal.ts` carries the rest of
  // the argument, including the cost the ruling accepted.
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

  // The Settings section rail (`plan/admin-design-contracts.md` §7a). Four strings, and
  // the two that are not section names both exist because the rail has no route to speak
  // for it: `summaryDefault` is what the collapsed summary says before the URL names a
  // section, and `current` is the phrase that replaces the `aria-current` a stylesheet
  // cannot set, so the active row is not marked by colour alone.
  "settings.rail.label": "Settings sections",

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
  // The command names the ONE path that reaches the stack a reader of this screen is
  // most likely looking at (issue #618). It used to say "run pnpm qcms:seed-fixtures
  // against a development database", and against the composed stack `pnpm dev:up`
  // creates there was no way to do that: the loader takes a `DATABASE_URL` and that
  // stack's Postgres publishes no host port. Worse than useless, because the sentence
  // had a success mode that changed nothing on screen - run against the separate dev
  // database it CAN reach, the command reports success and this library stays empty.
  // `pnpm dev:seed` runs the same loader inside the network (`scripts/dev-compose.mjs`,
  // documented in `docs/DEVELOPER_GUIDE.md`), so the remedy and the screen are on one
  // database. It is still qualified as a development command, because this screen
  // cannot know which database backs it and a deployed instance has no dev stack.
  "questions.empty.body":
    "Create the first question. To explore with the sample insurance library instead, run pnpm dev:seed against a local development stack.",
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
    "This editor does not save automatically. Nothing is stored until you select Create draft, and leaving this page first discards what you have written.",

  "questions.editor.heading": "Version {version}",
  "questions.editor.label": "Label",
  "questions.editor.help": "Help text",
  "questions.editor.helpHint": "Optional. Shown under the control.",
  "questions.editor.required": "An answer is required",
  "questions.editor.typeLocked": "Type is locked to {type}.",
  "questions.editor.save": "Save draft",
  "questions.editor.manualModel":
    "This editor does not save automatically. Your changes are stored when you select Save draft, and leaving this page first discards them.",
  "questions.editor.saved": "Draft saved.",
  "questions.editor.constraints": "Constraints",
  "questions.editor.noConstraints": "This type has no constraints to set.",
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
  // The #52 normalization, offered at the source (issue #53). A browser compiles the HTML
  // `pattern` attribute under stricter rules than this expression follows, so the renderer
  // rewrites it on every render. Storing the rewritten spelling instead makes that
  // unnecessary; the suggestion means the same thing as what was typed.
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

  // Author-supplied validation messages (task 048, ADR-32) and the boolean label
  // overrides (ADR-36). Both are edit-level fallbacks: the field shows the default as its
  // placeholder and a blank field means "inherit", so nothing here is ever stored.
  //
  // THE `questions.message.default.*` AND `questions.booleanLabel.default*` VALUES BELOW
  // ARE MIRRORS ACROSS THE R2 BOUNDARY, not this app's own wording. They restate what a
  // respondent would actually be shown, which the admin cannot import: the constraint
  // messages come from `packages/core/src/validate-answer.ts` (plus the required-answer
  // sentence from `apps/portal/lib/i18n/en.ts`) and the yes/no labels from
  // `BOOLEAN_AFFIRMATION` in `packages/a2ui-compiler/src/mapping.ts`. Change one of those
  // and change the twin here in the same commit, or the editor promises a default that is
  // not the one shown. `{n}` and `{bound}` are filled with the constraint's own bound.
  "questions.editor.messages": "Validation messages",
  "questions.message.note":
    "Optional. Leave a field blank and the respondent sees the default shown inside it. A field appears only for a constraint this question carries, so clearing the constraint clears its message too.",
  "questions.message.none":
    "There is nothing to write a message for yet. Require an answer, or set a constraint above, and a field appears for it.",

  "questions.message.label.required": "Message when no answer is given",
  "questions.message.label.minLength": "Message when the answer is too short",
  "questions.message.label.maxLength": "Message when the answer is too long",
  "questions.message.label.pattern": "Message when the answer does not match the pattern",
  "questions.message.label.min": "Message when the value is too small",
  "questions.message.label.max": "Message when the value is too large",
  "questions.message.label.integer": "Message when the answer is not a whole number",
  "questions.message.label.minSelected": "Message when too few options are selected",
  "questions.message.label.maxSelected": "Message when too many options are selected",
  // A date's bounds are the same two keys wearing different words: "too small" describes a
  // number, and an author reading it beside "Earliest date" would have to translate.
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

  "questions.options.legend": "Options",
  "questions.options.note":
    "An option ID is generated once, when the option is first named, and never changes again. Relabelling and reordering leave it alone, which is what keeps a rule matching the same answer years later (R6).",
  "questions.options.headLabel": "Label",
  "questions.options.headId": "ID",
  "questions.options.idPending": "Pending",
  "questions.options.idPendingTitle":
    "This row has no ID yet. One is generated from the label, once the row is named.",
  // The row's own name, as the card writes it ("Option 2 label"). Every other control on
  // the row names the row by its LABEL instead, so two rows' menus stay distinguishable
  // from each other; `rowFallback` is what an unnamed or blank row is called in that slot.
  "questions.options.label": "Option {position} label",
  "questions.options.rowFallback": "option {position}",
  "questions.options.reorder": "Reorder {row}",
  "questions.options.rowActions": "{row} row actions",
  "questions.options.insertAbove": "Insert option above {row}",
  "questions.options.insertBelow": "Insert option below {row}",
  // The single-pointer, non-dragging reorder path (WCAG 2.2 SC 2.5.7). Named per row like
  // every other item in this menu and like the pin list's own pair, so a screen reader
  // hears which option is about to move rather than two identical words.
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

  // The preview theme island (task 058, ADR-38). Two controls above every preview,
  // shared by the question preview, the draft preview and the published version view.
  //
  // The theme names are the palette's own names and are NOT translated as words: they
  // name a specific shipped theme, the way a typeface name does, so a locale that
  // rendered "Sand" as its word for sand would be naming something else. They stay in
  // the catalog regardless (ADR-27), because a locale may still need to transliterate
  // them, and because a label an operator reads has no business being a literal in a
  // component. The two mode names ARE prose and do translate.
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
  "questions.detail.deprecatedNote":
    "This version is deprecated: no new form can pin it. Forms that already pin it keep working exactly as they are, and no answer already collected changes.",

  // The question detail screen's rail (issue 650). The digest is four whole sentences
  // rather than a count and a fragment joined in the component: a locale that puts the
  // published version first, or that needs a different separator, changes it here (ADR-27).
  // `tPlural` picks the singular, which is the state a question spends its first minute in.
  "questions.rail.label": "Versions of {questionId}",
  "questions.rail.digestOne": "{count} version, v{version} published",
  "questions.rail.digest": "{count} versions, v{version} published",
  "questions.rail.digestNoneOne": "{count} version, none published",
  "questions.rail.digestNone": "{count} versions, none published",

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

  "forms.builder.crumbs": "Forms",
  "forms.builder.crumbLabel": "Breadcrumb",
  // The identity line under the heading on every form screen. This paragraph used to say
  // the builder's five sibling sections composed `forms.section.heading` while the builder
  // headed itself with the bare slug; neither half survived. The Code Owner's 2026-08-26
  // amendment heads all six with the section's name alone, that key is gone with issue
  // #538's sweep, and `app/(shell)/section-headings.test.tsx` is where the reasoning for
  // both now lives.
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
  "forms.save.pausedNoTarget":
    "Autosave is paused: every rule needs at least one question or step to show before the draft can be stored.",

  "forms.validation.title": "Validation",
  "forms.validation.none": "No issues. Everything here would pass a publish.",
  "forms.validation.countOne": "1 issue would block a publish.",
  "forms.validation.count": "{count} issues would block a publish.",
  "forms.validation.checking": "Checking the draft...",
  // The panel's refusal to vouch. It says what it does NOT know rather than reporting a
  // count it could not compute, because the alternative on a failed check is the panel
  // falling through to "No issues" and asserting publish-readiness it has no basis for.
  "forms.validation.unchecked":
    "The draft could not be checked, so this is not a current count of what would block a publish.",
  // The panel before it has checked anything at all, which is a different thing from a
  // check that failed and from a check that came back empty. The builder validates on the
  // first change rather than on load, so on a form opened and not touched this is the only
  // honest sentence: the zero it was seeded with is an initial value, not a verdict.
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
  "forms.step.movePin": "Move pin for {questionId}",
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
  "forms.step.copyQuestionId": "Copy question id {questionId}",
  "forms.step.copiedQuestionId": "Copied question id {questionId}",
  "forms.step.pinMoved": "{questionId} moved to position {position} of {total}",
  "forms.step.pinRemoved": "{questionId} removed from this step",
  "forms.step.emptyBody": "Pin a question from the library and it will appear here.",
  "forms.step.column.reorder": "Row actions",
  "forms.step.column.question": "Question",
  "forms.step.column.type": "Type",
  "forms.step.column.version": "Version",
  "forms.step.column.issues": "Issues",
  "forms.step.noIssues": "None",
  // The same distinction the validation panel makes, one row at a time: "None" is a
  // verdict that came back empty for this pin, and this is the absence of a verdict.
  "forms.step.issuesUnchecked": "Not checked",
  "forms.step.labelMissing": "No label in the library",
  "forms.step.labelUnknown": "Label not known",

  "forms.picker.title": "Add questions to {title}",
  "forms.picker.description":
    "Choose one or more published versions, then add them together. A deprecated version is listed but cannot be pinned, and a question already in this form cannot be pinned twice.",
  "forms.picker.search": "Search",
  "forms.picker.tableLabel": "Question versions",
  "forms.picker.hint":
    "Each version chosen here becomes a pin frozen at that version. Nothing upgrades it afterwards, and every pin stays changeable in the step's grid.",
  "forms.picker.column.choose": "Choose",
  // The checkbox's accessible name, and the same string the version's entry in the
  // chosen list is removed by. A checkbox announced as "checkbox, unchecked" on every
  // one of thirty rows tells a screen-reader author nothing about which row it sits in,
  // which is the property issue 570 put on this row's control and multi-select keeps.
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
  // A question is pinned once per form, so choosing one version of it rules out its
  // siblings for as long as that choice stands. Saying which is the point: the author is
  // looking at a row whose checkbox has just gone, and the reason is two rows away.
  "forms.picker.stateOtherVersionChosen": "Version {version} of this question is chosen",
  // No plural rule: the noun is inside the count's parentheses, not after it, so English
  // and every locale that renders this heading pick the same form. `tPlural` is for the
  // commit label below, where the noun does inflect.
  "forms.picker.chosenHeading": "Chosen ({count})",
  "forms.picker.chosenEmpty": "Nothing chosen yet. Check a version to add it.",
  // ADR-27: the count is a substitution into a chosen plural form, never a number
  // concatenated onto a fixed noun. The zero case is its own message rather than the
  // "other" form with a 0 in it, because "Add 0 questions to step" is a sentence no
  // locale wants and the button it sits on cannot be pressed anyway.
  "forms.picker.commitNone": "Add questions to step",
  "forms.picker.commit.one": "Add 1 question to step",
  "forms.picker.commit.other": "Add {count} questions to step",
  "forms.picker.empty": "No published question version matches this search.",
  "forms.picker.loadFailed":
    "The question library could not be loaded, so there is nothing to choose from. Close this dialog and reload the page to try again.",
  "forms.picker.cancel": "Cancel",

  "forms.rules.title": "Rules",
  "forms.rules.add": "Add rule",
  "forms.rules.empty": "No rules yet. A rule shows questions or steps when its condition matches.",
  "forms.rules.needPin": "Pin a question first: a condition has to read one.",
  "forms.rules.column.rule": "Rule",
  "forms.rules.column.issues": "Issues",
  "forms.rules.edit": "Edit",
  "forms.rules.remove": "Remove",
  // The dialog's own title names the rule being changed rather than saying "Edit rule",
  // because a form can have several and the reader has just chosen one of them. Since the
  // editor became a wizard (2026-08-30) it is also the dialog's only heading, so the rule
  // id has to be in it: the condition panel used to repeat it and no longer does.
  "forms.rules.editTitle": "Edit rule {ruleId}",

  // --- the rule wizard's three phases (Code Owner, 2026-08-30) ---
  //
  // TABS, so this string is what a screen reader announces before "tab 1 of 3". It names
  // what the three choices are ABOUT rather than repeating the dialog's own title, which
  // is already announced when the dialog opens.
  "forms.rules.phases": "Rule editing phases",
  // Numbered because the phases have a natural order and stating it costs nothing. The
  // numbers describe; nothing here enforces them, and an author may work in any order.
  "forms.rules.phaseWhen": "1. When",
  "forms.rules.phaseThen": "2. Then show",
  "forms.rules.phaseTest": "3. Test",
  // Phase navigation (Code Owner, 2026-08-30). The visible words are "Back" and "Next";
  // the accessible name names the phase each one goes to, so a reader who cannot see which
  // tab is selected is told where the press leads rather than only that it leads onward.
  // Both accessible names contain the visible word, which is what SC 2.5.3 asks for.
  "forms.rules.phaseBack": "Back",
  "forms.rules.phaseNext": "Next",
  "forms.rules.phaseBackTo": "Back to {phase}",
  "forms.rules.phaseNextTo": "Next, {phase}",
  "forms.rules.save": "Save",
  "forms.rules.cancel": "Cancel",
  "forms.rule.heading": "Rule {ruleId}",
  "forms.rule.when": "When",
  "forms.rule.show": "Show",
  // The combobox's own two strings. The toggle is named by the field it belongs to,
  // because a condition with five leaves renders five of them.
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

  // --- the target list at scale (Code Owner, 2026-08-30) ---
  //
  // The stated case is ten or more steps and hundreds of questions, where a flat wrap of
  // checkboxes is a wall rather than a control. These are the strings the grouping and the
  // filter need; `lib/forms/rule-targets.ts` owns what they describe.
  "forms.rule.targetsFilter": "Filter targets",
  "forms.rule.targetsFilterHint": "Matches a question id, a step id, or a step's name.",
  "forms.rule.targetsShowing": "Showing {shown} of {total} targets.",
  "forms.rule.targetsNoMatch": "No target matches that filter.",
  // Stated ABOVE the filter and never narrowed by it, because a filter that hides a target
  // an author has already ticked must not make the choice invisible. Same answer the
  // library picker's chosen pane gives to the same problem.
  "forms.rule.targetsSelected": "Selected: {targets}",
  "forms.rule.targetsSelectedNone": "Nothing selected yet. This rule would show nothing.",
  // USER-FACING, so it says the thing rather than citing where the thing is decided (Code
  // Owner, 2026-08-30). It carried "one forward pass" and "(ADR-16)", which name an
  // internal record and a piece of engine vocabulary to somebody who is trying to build a
  // form. The rule itself is simple enough to state in a sentence, and stating it is the
  // whole reason this list is on screen instead of hidden.
  //
  // PLAIN, in the same pass: no second-guessing what the reader might be feeling ("rather
  // than wondering where a question went") and no describing the rendering back to them
  // ("greyed out"). Each sentence is one fact about the rule or about this list.
  "forms.rule.targetsHelpLabel": "Why these cannot be shown",
  "forms.rule.targetsHelpDetail":
    "A rule can only show something the respondent has not reached yet, so it cannot point at anything at or before the last question its condition reads. Those targets are listed here rather than hidden, and cannot be selected. A whole step appears here when any one of its questions does, because showing a step shows every question in it. A rule that points backwards cannot be published.",
  "forms.rule.backwardWarning":
    "{targets} comes before a question this condition reads. A rule can only show something the respondent has not reached yet, so this rule cannot be published until that target is cleared.",
  "forms.rule.issues": "Issues with this rule",

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

  // --- the rules table's read-only sentence (`lib/forms/rule-sentence.ts`) ---
  //
  // Every entry here is a SENTENCE FRAME with placeholders, not a word to be glued to
  // its neighbours at the call site. That is ADR-27 taken seriously rather than
  // nominally: word order is part of a translation, and a module that concatenated
  // `"When "` + condition + `", show "` + targets would have hard-coded English clause
  // order in TypeScript while pretending the strings were localized. A locale that
  // fronts the consequent rewrites `forms.sentence.frame` here and nothing else.
  //
  // The frames are also why the module can hand the table SEGMENTS rather than prose:
  // it splits each frame on its own placeholders, so the emphasised names arrive already
  // separated from the punctuation and connectives around them.
  "forms.sentence.frame": "When {condition}, show {targets}",
  // A rule whose targets have not been chosen yet is a state the editor lets an author
  // sit in (`forms.rule.targetsNone`), so the table has to say what it does rather than
  // trail off after "show".
  "forms.sentence.frameNoTargets": "When {condition}, show nothing",
  // Grouping is a separate frame so a locale can bracket differently; see the module's
  // note on why a nested `and`/`or` is always bracketed.
  "forms.sentence.group": "({condition})",
  "forms.sentence.not": "not ({condition})",
  "forms.sentence.listComma": "{left}, {right}",
  "forms.sentence.listAnd": "{left} and {right}",
  "forms.sentence.listOr": "{left} or {right}",
  // Both defensive: the kernel's `and`/`or` are `.min(1)` and its `in`/`containsAny`
  // values are too, so neither empty shape is publishable. They are still reachable in a
  // draft the API handed back, and a sentence that silently omitted the branch would
  // read as a complete condition that is missing a clause.
  "forms.sentence.noBranches": "a group with no branches",
  // Reached by an ordinary edit rather than only by a malformed draft: a freshly created
  // `equals` against a text question carries `""` (`condition.ts`, `startingOperand`),
  // and "is exactly" followed by nothing reads as a truncated sentence.
  "forms.sentence.emptyValue": "an empty value",

  // One frame per leaf operator. These are prose, so they are worded to be read in a
  // sentence rather than picked from a list: `forms.op.*` is the operator picker's
  // vocabulary and says "is greater than or equal to", which is exact but stops a reader
  // mid-scan. The comparison each pair states is identical.
  // A step target names itself as one: `show` mixes question ids and step ids, and showing
  // a step is a different act from showing a question (they are separate visibility layers
  // that AND together). Without this a reader cannot tell the two apart in the sentence.
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
  // The same promise `forms.issue.unknown` makes for a publish code this build has never
  // heard of: an operator with no frame here still renders, and it renders as an
  // admission rather than as its own token dressed up as English.
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

  // The bench's summary digest (issue 519; `plan/admin-ux-audit.md` §3.7). Facts only,
  // and every one of them is also inside the panel: the rule is the dialog's own title
  // and the question count is the number of entries the "Hypothetical answers" fieldset
  // renders. Nothing here counts issues - the validation panel owns the screen's one
  // authoritative issue count (§5.6).
  //
  // "No rules to try" is reachable from the SCREEN's bench only (2026-08-30): the wizard's
  // is reached through a rule, so there is no state in which that one has none.
  "forms.bench.digest.noRules": "No rules to try",
  "forms.bench.digest": "{rule}, reads {questions}",
  "forms.bench.digest.questionOne": "1 question",
  "forms.bench.digest.questionOther": "{count} questions",

  "forms.settings.title": "Form settings",
  "forms.settings.note": "Abuse controls for this form. They apply the next time it is published.",
  "forms.settings.challengeRequired": "Require a challenge before answering",
  "forms.settings.challengeHint":
    "Starting a session has to pass this deployment's challenge check first.",
  // Says what is true of the deployment, not which provider flag it is running.
  // The admin is told behaviour, never a flag value (ADR-24, issue #725).
  "forms.settings.challengeUnenforceable":
    "This deployment cannot check a challenge, so requiring one here enforces nothing until an operator configures a challenge provider.",
  "forms.settings.minSubmitDefault": "Use the deployment's minimum time",
  "forms.settings.minSubmit": "Minimum time before a submit is accepted (milliseconds)",
  "forms.settings.minSubmitHint":
    "A submit that arrives faster than this is refused. It exists to make an instant automated post fail, so keep it well under the time a person needs.",
  // No "Save settings" and no "Settings saved." (Code Owner, 2026-08-29). The settings
  // autosave on the builder's own debounce, so there is no press to label and no second
  // confirmation to give: `plan/admin-design-contracts.md` §6 gives this screen exactly
  // one statement of when work was stored and the ambient strip is it. A refusal still
  // has to be said, because a switch that did not take is the one thing an author cannot
  // see for themselves.
  "forms.settings.failed": "The settings could not be saved. {message}",
  // The settings summary digest (issue 519; `plan/admin-ux-audit.md` §3.7). It states
  // the two switches the panel holds and nothing else - in particular it makes no claim
  // about saving, because `plan/admin-design-contracts.md` §6 gives this screen exactly
  // one save statement and the builder's ambient strip is it.
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
  // Also user-facing, and cleaned with the picker's help text on 2026-08-30 for the same
  // reason: an author reading a refused publish needs the rule, not its citation.
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
  "forms.issue.unknown": "The engine reported an issue this screen has no wording for ({code}).",
  // Blank authored text (issue #366). The publish gate names the question and the locale;
  // this is the sentence that says why a value made of spaces is not a value.
  "forms.issue.blankText":
    "This text is only whitespace, so it would reach a respondent as no text at all. Type something, or remove the entry.",

  // Warnings (issue #123). Worded apart from the issue list above because the two say
  // different things: an issue is why a publish is refused, a warning is something that
  // will publish and probably will not behave the way it reads.
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
  // Accepting an agent proposal that carried new questions (issue #823). The whole
  // accept is refused when one proposed definition is not acceptable, so the sentence
  // has to name WHICH question and say that nothing at all was stored - an operator
  // looking at a card listing three questions cannot act on "the request failed".
  "forms.error.proposedQuestionRefused":
    "Nothing was saved. The question \u201c{question}\u201d that the assistant proposed was refused: {reason}",
  "forms.error.proposedQuestionIdReused":
    "Nothing was saved. The question ID \u201c{question}\u201d has been used before, and an ID is never reused for a different meaning (R6). Ask the assistant for a different ID.",
  "forms.error.proposedQuestionSlugTaken":
    "Nothing was saved. The library slug for the proposed question \u201c{question}\u201d is already in use. Rename the existing question, or ask the assistant for a different ID.",
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

  // The `forms.tab.*` names outlived the tab strip they were written for: the §7 rail
  // carries the same six sections on all eight form screens (issue 561), the breadcrumb
  // builds its last crumb from the same names, the section screens' own `<h1>` is one of
  // them, and issue #536 composes each screen's browser-tab title from them, so all six
  // are still one place. Only the strip's own landmark label went with `form-tabs.tsx`.
  //
  // "Version history" rather than "History" (issue 679). Three things pushed the same way
  // and none of them was consistency for its own sake. The screen's approved drawing names
  // it that (`plan/admin-shell-poc/preview-versions-poc.html`, the `<h1>` at the head of
  // its version-list screen). The app's own prose already did, twice, in the two links that
  // point at this screen: `forms.publish.viewHistory` and `forms.history.backToHistory`
  // both read "version history". And "History" was the one name in the six that did not say
  // what it listed, which reads as under-specified in a rail and outright ambiguous once
  // composed into a heading, where "History: Life insurance" could as easily mean the
  // form's edit history or its responses. The rail follows the screen's name by the rule
  // `plan/admin-design-contracts.md` §7 records, which anticipates exactly this rename.
  //
  // `forms.section.heading` ("{section}: {slug}") stood here until issue #538's sweep.
  // The Code Owner's 2026-08-26 amendment took it out of the `<h1>`, which left it
  // defined and read by nothing; `app/(shell)/section-headings.test.tsx` records why the
  // heading no longer composes it. The browser-tab title issue #536 adds does compose a
  // section name with a form's identity, but from the route's `formId` rather than a slug
  // it would have to fetch, so it carries its own key (`title.formSection`).
  // "Form details" rather than "Builder" since 2026-08-26 (Code Owner). The row leads to
  // the screen carrying the form's own title, settings, rules, test bench and validation,
  // and `admin-shell-poc.html` labels it for its subject rather than for the tool. It also
  // stopped being the only row that meant that: the builder briefly carried a second,
  // nested "Form details" row beside this one, which is two rows saying one thing. Naming
  // this one correctly is what let the other go. The builder route's own `<h1>` is the
  // bare slug (issue 679), so nothing else on the screen moves with this.
  "forms.tab.builder": "Form details",
  "forms.tab.preview": "Preview",
  "forms.tab.versions": "Version history",
  "forms.tab.links": "Links",

  "forms.publish.action": "Publish",
  "forms.publish.title": "Publish {slug}?",
  // Assembled from three counted phrases rather than written as one sentence with three
  // numbers in it, because "Freezes 1 steps, 1 pinned questions, 1 rules." is what the
  // single-sentence version says on a small form - and a small form is what an author
  // publishes first. `tPlural` picks the form; the sentence just joins them.
  "forms.publish.freezes": "Freezes {steps}, {pins}, {rules}.",
  "forms.publish.freezes.steps.one": "1 step",
  "forms.publish.freezes.steps.other": "{count} steps",
  "forms.publish.freezes.pins.one": "1 pinned question",
  "forms.publish.freezes.pins.other": "{count} pinned questions",
  "forms.publish.freezes.rules.one": "1 rule",
  "forms.publish.freezes.rules.other": "{count} rules",
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
  // Spoken, not shown (issue #377). The work list below carries the detail and every
  // entry in it is a link, so what the live region owes an operator is that the publish
  // did not happen and roughly how much there is to fix - not the list read aloud.
  "forms.publish.blockedAnnounce.one": "Publish blocked: 1 issue to fix, listed below.",
  "forms.publish.blockedAnnounce.other": "Publish blocked: {count} issues to fix, listed below.",
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
  // Spoken, not shown (issue #377), and worded to the same rule as the publish summary.
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
  "forms.links.mintTitle": "Mint secure links",
  "forms.links.expiresAt": "Expires",
  // The zone is named here because this is where the promise is made, and it stays UTC
  // even though the links table went operator-local in issue #279. The two are not in
  // tension. The stored instant is the end of the chosen day in UTC (`endOfDay` in the
  // forms actions), so this sentence states the rule the API will actually enforce for a
  // respondent who may be anywhere, while the table states that same instant on the clock
  // the operator reading it is on. A dialog promising "the end of your today" would be
  // promising something the stored value does not say, and two operators picking the same
  // calendar day would mint links dying up to a day apart.
  "forms.links.expiresAtHint": "The link stops working at the end of this day, UTC, used or not.",
  "forms.links.oneTime": "One-time (stops working after the first use)",
  "forms.links.count": "How many",
  "forms.links.countHint": "Up to {max} at a time.",
  "forms.links.confirmMint": "Mint",
  "forms.links.pending": "Minting...",
  "forms.links.cancel": "Cancel",
  "forms.links.mintFailed": "No links were minted. {message}",
  "forms.links.mintedTitle.one": "1 link minted",
  "forms.links.mintedTitle.other": "{count} links minted",
  "forms.links.mintedOnce":
    "Copy these now. The server stores a link's state, never its token, so these URLs cannot be shown again.",
  // Spoken, not shown (issue #377). Deliberately NOT the URLs: a token read aloud cannot
  // be copied, and the panel that holds them stays on screen until the operator dismisses
  // it. What the announcement owes is that the mint succeeded and that the panel is the
  // only chance to take the URLs out of it.
  "forms.links.mintedAnnounce.one":
    "1 secure link minted. It is listed below and cannot be shown again.",
  "forms.links.mintedAnnounce.other":
    "{count} secure links minted. They are listed below and cannot be shown again.",
  "forms.links.copy": "Copy URL",
  "forms.publicLink.heading": "Public form link",
  "forms.publicLink.copy": "Copy",
  "forms.publicLink.opensNewTab": "(opens in a new tab)",
  "forms.publicLink.helpLabel": "What is this link?",
  // Both hints are the POC's sentence, split by the state the form is actually in rather
  // than stating the condition and leaving the reader to work out which half applies.
  // "the links below" rather than "on the Links screen" since 2026-08-26: this block moved
  // ONTO that screen, and a sentence pointing at the screen it is standing on would send a
  // reader looking for somewhere else. The distinction it draws is the whole reason the two
  // are allowed to sit together, so it names what is actually beneath it.
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
  "forms.links.listFailed": "The links could not be loaded. {message}",

  "forms.error.invalidLinkId": "That is not a valid link.",
  "forms.error.linkNotFound": "That link no longer exists, or it is already revoked.",
  "forms.error.linkExpiryInvalid": "Pick an expiry in the future.",
  "forms.error.invalidLinkBatch": "Ask for between 1 and {max} links.",
  "forms.error.noDraft": "There is no draft to publish.",
  "forms.error.publishRejected": "The draft cannot be published yet. The reasons are listed below.",
  "forms.error.previewRejected": "The draft cannot be previewed yet. The reasons are listed below.",
  // The rules-would-not-evaluate case, which has nothing to list. It exists so the
  // sentence above can keep promising a list: a code that carries no issues gets its own
  // copy rather than borrowing one that describes a screen the author is not looking at.
  "forms.error.previewUnavailable":
    "This draft compiled, but its rules could not be evaluated for the answers entered. Reset the answers to start again.",
  "forms.error.versionNotFound": "That version does not exist.",

  // --- agent-assisted form building (task 041, flag-gated) --------------------
  //
  // The panel's own copy. Two rules from the 041 deliverable and
  // ADR-25 shape everything below: Accept "merges the proposal into the working
  // draft; never publishes" (there is no publish/erase/link/webhook affordance here
  // at all, by construction), and every diff line is worded so `+`/`~` is never the
  // only signal - the marker travels in the sentence itself.
  "forms.assist.title": "Assistant",
  "forms.assist.collapse": "Collapse the assistant panel",
  "forms.assist.expand": "Expand the assistant panel",
  "forms.assist.emptyHint": "Describe the form you want.",
  "forms.assist.conversationLabel": "Conversation with the assistant",
  "forms.assist.turnYou": "You",
  "forms.assist.turnAssistant": "Assistant",
  "forms.assist.inputLabel": "Describe the next change",
  "forms.assist.send": "Send",
  "forms.assist.working": "The assistant is working.",
  "forms.assist.workingTool": "The assistant is using a tool: {tool}",

  "forms.assist.proposalHeading": "Proposal",
  "forms.assist.diffCount.one": "1 change proposed.",
  "forms.assist.diffCount.other": "{count} changes proposed.",
  "forms.assist.validationClean": "Validation passes.",
  "forms.assist.diffAdded": "Added: {label}",
  "forms.assist.diffChanged": "Changed: {label}",
  "forms.assist.diffEmpty": "This proposal makes no changes to the current draft.",
  "forms.assist.kind.step": "Step",
  "forms.assist.kind.question": "Question",
  "forms.assist.kind.rule": "Rule",
  "forms.assist.rationale": "Assistant's rationale",
  "forms.assist.accept": "Accept into draft",
  "forms.assist.discard": "Discard",

  // Two provider failures, two sentences, because the advice is opposite
  // (issue #818). Neither repeats what the provider said: no vendor message,
  // no vendor error code, no URL and no key material reaches this copy
  // (SEC-8). The split is decided upstream from the SDK's `isRetryable`.
  "forms.assist.error.PROVIDER_ERROR": "The assistant is unavailable right now. Try again shortly.",
  "forms.assist.error.PROVIDER_REJECTED":
    "The model provider refused this request, and trying again will not help. Check the provider account and the assistant settings for this deployment.",
  "forms.assist.error.NO_PROPOSAL":
    "No proposal could be produced from the current draft. Try describing a smaller change.",
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

  // --- operations: responses, erasure, webhooks (task 035) -------------------
  //
  // Two families of string here describe what the SYSTEM does rather than what the
  // screen looks like, and both are asserted in the browser suite rather than left
  // as prose a later edit could quietly falsify:
  //
  // - **`ops.erase.*`** states ADR-17 in the operator's terms: the answers go, the
  //   tombstone stays, and webhook consumers that already received the submission are
  //   not affected by any of it. It is worded as consequences, not as "are you sure",
  //   because the confirmation's job is to make an irreversible act deliberate.
  // - **`ops.webhooks.secret*`** never promises the secret can be recovered, because
  //   it cannot: the API stores ciphertext and has no route that decrypts it back out
  //   (SEC-6). Same rule as `recovery.*` above.

  "forms.tab.responses": "Responses",
  "forms.tab.webhooks": "Webhooks",

  "ops.common.none": "-",
  "ops.common.cancel": "Cancel",
  "ops.common.working": "Working…",
  "ops.common.copy": "Copy",
  "ops.common.copied": "Copied to the clipboard.",
  "ops.common.copyFailed": "That could not be copied. Select the text and copy it manually.",

  // The responses area landing screen: pick a form, or open the erasure log.
  "ops.area.responses.title": "Responses",
  "ops.area.responses.intro":
    "Responses are held per form. Open a form to browse, export or erase what it collected.",
  // `{slug}` and not `{title}` (issue #312). Both list screens are fed `form.slug`, and
  // they can be fed nothing else: `GET /admin/forms` answers with `FormListItem`, which
  // carries no title at all. A placeholder named for a value the caller cannot supply is
  // a promise the catalog cannot keep, and the slug is what these screens identify a form
  // by everywhere else ("Open a form from the link in its Slug column").
  "ops.area.responses.pickForm": "Open responses for {slug}",
  "ops.area.responses.noForms": "No forms exist yet, so nothing has been collected.",
  "ops.area.responses.erasureLog": "Erasure log",
  "ops.area.responses.formsFailed": "The form list could not be loaded. {message}",

  "ops.area.webhooks.title": "Webhook operations",
  // "screen", not "tab" (issue #651). This sentence is the one place the app explains the
  // deployment-wide / per-form split to an operator who has landed here looking for where
  // to add an endpoint, so sending them to a control that does not exist is the specific
  // failure it was written to prevent. Issue #561 replaced the in-header section strip
  // with the `@rail` slot on all eight form-scoped screens and deleted `form-tabs.tsx`;
  // a form's siblings are now rows in a navigation column beside the content, listed
  // under "Sections" (`forms.rail.sections`). The clause naming the list below is what
  // makes the sentence actionable rather than merely accurate - the destination is one
  // click away on this page.
  "ops.area.webhooks.intro":
    "The dead-letter queue below covers every form. Endpoints are configured per form, on that form's Webhooks screen - open one from the list below.",
  // `{slug}`, for the same reason as `ops.area.responses.pickForm` above.
  "ops.area.webhooks.pickForm": "Configure webhooks for {slug}",
  "ops.area.webhooks.noForms": "No forms exist yet, so there is nothing to deliver.",

  // The response browser.
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
  "ops.responses.filter.dayHint": "Whole days, in UTC.",
  // A filter value the address carried that no filter accepts (issue 521): a mistyped
  // date, a `flagged` that is not true or false, a version that is not a number. The
  // toolbar cannot produce one, so the operator either hand-edited the address or
  // followed a link someone else did. It is named rather than dropped in silence
  // because the count beside the table is a number an operator acts on, and a total
  // for the whole form read as a total for one week is the same false statement this
  // screen was fixed for, only quieter.
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
  // The answer preview (issue 515). Every part of the cell is a key, separator and
  // ellipsis included (ADR-27): a locale that writes lists differently, or that does
  // not use "…" as a continuation mark, has nothing to change in the component.
  // `preview.clipped` marks a value cut to its character budget; `preview.more` marks
  // answers the row did not have room for. They read alike on purpose and are separate
  // keys because they say different things.
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
  // The empty-state headings (issue 514). `plan/admin-design-contracts.md` §3 gives
  // every empty state a heading and one sentence; the seven screens that shipped a
  // bare muted paragraph already had the sentence, so what each gains here is the
  // heading above it. The FILTERED variants add no key at all: §3 swaps the heading
  // to a "no matches" line and drops the sentence, and the "no matches" line each
  // screen already had is exactly that heading.
  "ops.responses.emptyTitle": "No responses yet",
  "ops.responses.empty": "Nothing has been submitted to this form yet.",
  "ops.responses.filteredEmpty": "No response matches these filters.",
  "ops.responses.total.one": "1 response",
  "ops.responses.total.other": "{count} responses",
  "ops.responses.pageOf": "Page {page} of {pages}",
  "ops.responses.previous": "Previous page",
  "ops.responses.next": "Next page",
  "ops.responses.open": "Open response {sessionId}",
  "ops.responses.listFailed": "The responses could not be loaded. {message}",

  // Export.
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
  "ops.export.from": "Submitted from",
  "ops.export.to": "Submitted to",
  "ops.export.dayHint": "Whole days, in UTC.",
  "ops.export.download": "Download",
  "ops.export.noVersions": "This form has no published version, so there is nothing to export.",
  // One sentence per format, because they are different files: an empty CSV is its
  // header row, an empty JSON export is `[]`. The dialog already knows the selected
  // format (`ops.export.versionIgnored` turns on it), so a single sentence describing
  // CSV while JSON was selectable was a claim the control above it disproved.
  "ops.export.emptyNote.csv":
    "A CSV export that matches nothing downloads as a file with only its header row.",
  "ops.export.emptyNote.json": "A JSON export that matches nothing downloads as an empty list.",

  // The response detail.
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
  // "screen", not "tab", and the link's own label with it (issue #651). Same staleness as
  // `ops.area.webhooks.intro`: the tab strip went with `form-tabs.tsx` in issue #561, and
  // the anchor beside this sentence goes to the form's Links screen, which is a row in the
  // rail rather than a tab in a header.
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

  // Erasure (ADR-17).
  "ops.erase.button": "Erase respondent data…",
  "ops.erase.title": "Erase this respondent's data?",
  "ops.erase.irreversible":
    "This deletes every answer and the submission for this session. There is no undo: no soft delete, and nothing this screen can restore from.",
  "ops.erase.tombstoneStays":
    "A tombstone remains - the session id, the form, the version, when it was erased and why. That is the compliance record, and it holds no answers.",
  // Three separate facts, and each has an assertion behind it (task 059): a delivered
  // event is genuinely beyond reach and the consumer's to erase as an independent
  // controller; an undelivered one is cancelled by `eraseSession` and filtered out of
  // both `claimDueDeliveries` and the redeliver door, so "never sent" is structural
  // rather than a promise; and QCMS's own `outbox.payload` copy of the answers is
  // redacted in place. 035's wording ("it may still be sent") described the pre-059
  // behaviour truthfully and is now false - do not restore it.
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

  "ops.tombstone.title": "Erased",
  "ops.tombstone.body":
    "This session's answers were erased. What remains is the tombstone below (ADR-17).",
  "ops.tombstone.sessionId": "Session",
  "ops.tombstone.formVersion": "Form version",
  "ops.tombstone.erasedAt": "Erased",
  "ops.tombstone.reason": "Reason",
  // A reason this build does not recognise is quoted back inside a sentence rather
  // than rendered raw as if it were prose - the same closed-vocabulary-plus-fallback
  // shape `flagReasonText` uses. The column is free text at the database, so an
  // unrecognised value has to survive as far as here.
  "ops.erase.reason.unknown": "Recorded as {reason}",

  // The erasure log.
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
  "ops.erasures.back": "Back to responses",

  // Webhook configuration.
  "ops.webhooks.heading": "Webhook endpoints",
  // "except a flagged one" is not a hedge, it is what the submit slice does:
  // `apps/api/src/features/responses/submit/handler.ts` enqueues `response.submitted`
  // only when `flaggedReason === undefined`, and the release door is the unflag action
  // on the response detail (`ops.detail.unflag`). "Operator" rather than "admin":
  // `scripts/check-admin-theme.mjs` fails any user-facing string naming this app that,
  // and operator is the vocabulary the rest of the catalog uses. The earlier wording
  // promised "every submission", which this task's own unflag flow disproves.
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
  // The API's create and rotate routes always return a secret, so this is the shape of
  // a broken contract rather than a variant. It says so plainly and names the recovery,
  // because an empty box under "Copy this secret now" tells an operator nothing.
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

  // The delivery dashboard.
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
  // The cancelled row stays on the dashboard with its reason rather than vanishing,
  // because the operator question this screen answers is "what happened to that
  // delivery" and a missing row answers nothing (task 059).
  "ops.deliveries.cancelled.session_erased":
    "Cancelled: the respondent's data was erased, so this event was never sent and its stored copy of the answers has been redacted.",
  "ops.deliveries.cancelled.unknown": "Cancelled. Recorded reason: {reason}.",
  "ops.deliveries.cancelledAt": "Cancelled",
  "ops.deliveries.attemptsHint":
    "Attempts that failed. A delivery that succeeded first time shows zero.",
  "ops.deliveries.latency": "{ms} ms",
  // Two states reach this sentence and it used to describe only one (issue #312). A row
  // that has never been tried and a row that was redelivered are identical here on
  // purpose: `resetDeliveryForRedelivery` clears the whole last-attempt record rather
  // than the error alone, precisely so a cleared error cannot sit beside a stale
  // `last_status: 500` (`packages/db/src/queries/deliveries.ts`). So "yet" was a claim
  // about history the panel cannot make. What it CAN say is true of both: nothing has
  // been attempted since this delivery was queued, and the second sentence names the
  // reason a row with attempts behind it can read that way.
  "ops.deliveries.noAttempt":
    "No attempt on record: nothing has been sent since this delivery was queued. Redelivering clears the previous attempt, so a row queued again reads the same as one never tried.",
  "ops.deliveries.showDetail": "Show request and response for {event}",
  "ops.deliveries.hideDetail": "Hide request and response for {event}",
  // The row trigger's digest (issue 519; `plan/admin-ux-audit.md` §3.8). Three facts,
  // each of which the panel below also states in full: the trigger is a shorthand for
  // the record, never the only copy of it (§3.7).
  "ops.deliveries.digest": "{status}, {attempts}",
  "ops.deliveries.digest.withLatency": "{status}, {attempts}, {latency}",
  "ops.deliveries.digest.attemptOne": "1 failed attempt",
  "ops.deliveries.digest.attemptOther": "{count} failed attempts",
  "ops.deliveries.attemptSummary": "This delivery",
  "ops.deliveries.requestHeaders": "Request headers",
  "ops.deliveries.signatureMasked":
    "The signature is masked before it is stored, so this record never held the HMAC.",
  "ops.deliveries.responseCode": "Response code",
  // "stored prefix" rather than a character count: the API keeps a bounded prefix and
  // this app is not told how long the bound is, so naming a number here would be a
  // claim about a constant in another package that nothing keeps in step.
  "ops.deliveries.responseBody": "Response body (stored prefix)",
  "ops.deliveries.noResponse": "No response arrived: {error}",
  "ops.deliveries.emptyBody": "The response body was empty.",
  // Cause-free on purpose: the body is removed by erasure *and* by the retention
  // sweep, and a sentence naming one would be false whenever the other did it. Where
  // the cause matters the row already carries it (a cancelled delivery states its
  // reason). "Removed" rather than "expired" for the same reason.
  "ops.deliveries.redactedBody": "The stored response body was removed on {when}.",
  "ops.deliveries.lastError": "Last error",
  "ops.deliveries.emptyTitle": "No deliveries yet",
  "ops.deliveries.empty": "Nothing has been delivered for this form yet.",
  "ops.deliveries.loadFailed": "The deliveries could not be loaded. {message}",

  // The dead-letter queue.
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

  // Error codes raised by the 023/024/025 routes.
  "ops.error.invalidQuery": "One of those filters is not a value the server accepts.",
  "ops.error.invalidSessionId": "That is not a valid session id.",
  "ops.error.responseNotFound": "There is no such response for this form. It may have been erased.",
  "ops.error.sessionNotFound": "There is no such session.",
  "ops.error.submissionNotFound": "That session has not been submitted.",
  "ops.error.webhookNotFound": "That endpoint no longer exists for this form.",
  // Stated as the deployment's rule rather than as an absolute one (issue #312). The https
  // requirement and the private-address ban are both lifted by
  // `QCMS_WEBHOOK_ALLOW_PRIVATE`, which on-prem topologies that post to internal systems
  // legitimately set (`apps/api/src/features/webhooks/ssrf.ts`), so the old sentence told
  // an operator working in one of those deployments a rule their own API does not enforce.
  // The flag is NOT named: ADR-24's "clients receive behavior, not flag values" is
  // absolute since 2026-08-31, and an admin screen has no business printing an
  // environment variable at an author either way. "unless this deployment allows private
  // targets" is the behaviour statement that leaves the sentence true in both
  // configurations without saying which one is in force.
  "ops.error.webhookUrlRejected":
    "That URL was refused. A webhook target must be an absolute URL, and unless this deployment allows private targets it must also use https and must not point at a private or reserved address.",
  "ops.error.deliveryNotFound": "That delivery no longer exists.",
  // A server action that REJECTED rather than returning a failure state - a transport
  // error, or a body that would not parse. Deliberately says nothing about the thrown
  // value: it can carry a URL or a body fragment, and neither belongs on screen.
  "ops.error.unexpected":
    "That did not reach the server, so nothing changed. Check the connection and try again.",
  // The 409 `DELIVERY_NOT_REDELIVERABLE` answer, for a delivery whose response the
  // database no longer holds. Two ways in, and the sentence covers both because the
  // API cannot tell them apart and neither can the operator act on the difference:
  //
  //  - **Erasure** (task 059) landed between render and click. Erasure cancels the
  //    session's still-sendable deliveries and the dead-letter queue excludes
  //    cancelled rows, so a freshly loaded queue has no erased row to press; the race
  //    remains, where the queue renders, the erasure commits, and the operator then
  //    presses Redeliver (or "Redeliver all" iterates ids it displayed before the
  //    commit). The bulk summary's refused variant
  //    (`ops.deadLetters.redeliverPartial`) exists for the same race.
  //  - **Retention** (issue #329) aged the payload out. This one is no race at all:
  //    a dead letter older than QCMS_OUTBOX_PAYLOAD_TTL_MS (default 30 days) sits on
  //    the queue looking redeliverable, and pressing Redeliver is refused. It is the
  //    ordinary path an operator will meet.
  //
  // Do NOT re-describe this path as dead, and do not narrow the sentence back to
  // erasure. It is a live guard on a privacy control, and a comment claiming
  // otherwise is an invitation to delete it - which is exactly how the "sole/only
  // door" comments this repo warns about rot.
  "ops.error.deliveryNotRedeliverable":
    "The response that delivery carries is no longer held, so it will not be re-sent.",
  // Reachable only from a forged or malformed action payload: the dialog offers a
  // closed set of reasons and the action re-checks it, because the value is written
  // onto a tombstone that outlives the data it describes. It is in the catalog anyway
  // (ADR-27) - a defensive branch that renders is still a rendered string.
  "ops.error.invalidErasureReason":
    "That erasure reason is not one this build records, so nothing was erased.",

  // --- the form-subtree rail (`plan/admin-design-contracts.md` §7, issue 559) ---
  //
  // The rail's accessible name says what it carries rather than what it is: a `nav`
  // is already announced as a navigation landmark, so repeating the word here would
  // make a screen reader say it twice. Naming the form as well is what keeps this
  // distinct from the topbar's own landmark on the same page.
  "forms.rail.label": "{slug} steps and sections",
  "forms.rail.steps": "Steps",
  "forms.rail.formMenu": "Actions for {title}",
  "forms.rail.rules": "Rules",
  "forms.rail.sections": "Sections",
  // The ordinal beside a step title. A separate string rather than a template at the
  // call site because a locale that numbers differently changes it here (ADR-27).
  "forms.rail.stepPosition": "{position}.",
} as const;

export type MessageKey = keyof typeof messages;

/**
 * Resolve a counted message, picking the singular or the plural form.
 *
 * Both keys are passed in rather than assembled from a base string, so a missing form is a
 * type error here instead of a `undefined` rendered to an operator. `count` is substituted
 * as `{count}` on top of any other parameters.
 *
 * English has two forms, which is what this covers. A locale with more (Polish has four,
 * Arabic six) needs `Intl.PluralRules` to choose between a wider key set - a change to this
 * one function and to the catalog, which is exactly the seam ADR-27 asks for and the reason
 * the plural choice does not live at the call sites.
 */
export function tPlural(
  one: MessageKey,
  other: MessageKey,
  count: number,
  params?: Readonly<Record<string, string | number>>,
): string {
  return t(count === 1 ? one : other, { ...params, count });
}

/** Resolve a message, substituting `{name}` placeholders. */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template: string = messages[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
