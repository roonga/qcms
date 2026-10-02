/**
 * Portal shell message catalog (task 029) - owned source, single locale (en).
 *
 * Catalog structure per ADR-11: a flat map of dotted message keys to templates.
 * Only shell chrome lives here (buttons, progress text, error-page copy, receipt
 * labels). Question and step text is already resolved into the compiled A2UI at
 * publish time (ADR-18) and rendered by @roonga/qcms-ui, so it is never in this catalog.
 * A second locale is a new catalog module selected by the same key set.
 */

export const messages = {
  // The brand mark and the document title are the operator's (task 053, ADR-30 +
  // ADR-27, folding issue #25): `QCMS_PORTAL_BRAND_NAME` supplies them, and this
  // is only the fallback for a deployment that has not set it. It is deliberately
  // generic - a respondent opening a registration link is looking at THEIR
  // organisation's form, and the engine's own name is not information they need.
  "brand.defaultName": "Questionnaire",
  "app.description": "Complete your questionnaire.",

  "action.skipToContent": "Skip to content",
  "action.start": "Start",
  "action.back": "Back",
  "action.continue": "Continue",
  "action.submit": "Submit",

  "progress.step": "Step {current} of {total}",
  // The per-instance step presentation's chrome (task 076, ADR-27, ADR-28 as amended
  // 2026-09-29). The indicator counts VIEWS, so a three-vehicle group is three of them;
  // naming the instance is what keeps those three pages legible as three vehicles rather
  // than as three unrelated steps of one form. An ordinary step keeps `progress.step`.
  "progress.stepNamed": "Step {current} of {total}: {label}",

  // The bare-root landing (`app/page.tsx`), whose heading is the brand name.
  "home.body": "Open your questionnaire from the link you were sent.",

  "entry.title": "You are invited to complete this form",
  "entry.startHint": "This should take a few minutes. Your answers are saved as you go.",

  "errorSummary.title": "Please fix the following before continuing",
  // Each error-summary entry names its own question, so the links have distinct
  // accessible names and a screen-reader user can tell which field each one jumps
  // to (WCAG 3.3.1, issue #21). The whole sentence is one template rather than a
  // label concatenated with a message: word order and punctuation around the
  // label are a translator's decision, not the component's.
  "errorSummary.missingRequiredNamed": "{label} needs an answer.",
  // Fallback for a missing-required question the step document carries no label
  // for (defensively: a control the label walker does not reach, or a label that
  // resolved blank). Unnamed but still readable, and never a broken sentence.
  // It is a CONSTANT, so it is never an entry's whole name: on its own it made
  // every label-less entry byte-identical (issue #326). It is the sentence BODY
  // that `errorSummary.positional` names, and the last-resort wording for an
  // entry that has neither a label nor a place on the page.
  "errorSummary.missingRequired": "This question needs an answer.",
  // The entry for a question the document gave no label, named by its position
  // among the step's VISIBLE questions instead (issue #326, WCAG 3.3.1). No two
  // questions share a position, so two label-less entries are always distinct -
  // structurally, rather than because an author happened to write distinct
  // labels. `{message}` is whatever the entry would otherwise have said: the
  // author's own wording (ADR-32) or the unnamed default above. "Question" is
  // the respondent's word for a field here, matching the progress indicator's
  // vocabulary; the position counts the page, never the summary.
  "errorSummary.positional": "Question {position}: {message}",
  // The same entry when the question's author supplied their own `required`
  // message (task 048, ADR-32). The label stays the anchor and the author's
  // wording replaces only the sentence body, so two questions carrying identical
  // custom text still have distinct accessible names (WCAG 3.3.1). Only the
  // separator is this catalog's to translate; the message itself is the author's
  // and is never modified.
  "errorSummary.namedCustom": "{label}: {message}",
  "answer.invalid": "That answer is not valid.",
  // The repeating group's own controls and refusals (task 073). The Add and Remove
  // labels themselves are NOT here: they are compiled into the stored document from
  // the compiler's lexicon (ADR-36's precedent), so a published form keeps the wording
  // it was published with. What lives here is the portal's own chrome: what a refused
  // operation says, and what the polite status region announces.
  "errorSummary.inInstance": "{instance}: {message}",
  "repeat.maxReached": "You have added as many as this form allows.",
  "repeat.notAddable": "This part of the form is not one you can add to.",
  "repeat.failed": "We could not make that change. Please try again.",
  "repeat.added": "{label} added.",
  "repeat.removed": "{label} removed, {count} remaining.",
  "repeat.removedLast": "{label} removed, none remaining.",
  // The flow segment's error boundary (task 073). It is NOT the deploy-skew landing, which
  // no page of this app can be: Next throws before the segment renders and a production
  // build answers a bare 500 (ADR-43's amendment). What reaches this screen is an error
  // thrown while the segment renders, and the remedy is the same, which is to re-read the
  // step. The body says what survived, because a respondent arriving here has no other way
  // to know.
  "repeat.staleStep.title": "This page was out of date",
  "repeat.staleStep.body":
    "We could not show that step. Every answer you had already saved is kept. Anything you typed on this step without saving will need typing again.",
  // The page-level notice for a whole-step post the API refused outright (task 073, ruling
  // Q29). It has to say that nothing was saved, because the respondent is looking at a step
  // that still holds everything they typed and has no other way to tell.
  "step.notSaved":
    "We could not save your answers just now. Nothing was saved, and everything you typed is still here. Please press Continue again.",
  "flow.submitReady": "You have answered everything. Submit your responses when you are ready.",
  "session.lost.title": "Something went wrong",
  "session.lost.body": "We could not reach the server. Please try again.",

  // Live-region announcements (task 030). Read by screen readers only; never
  // shown visually. Step changes announce the destination; branch changes
  // announce how many questions appeared or disappeared so the change is
  // perceivable to someone who cannot see the layout shift.
  "announce.stepChange": "Step {current} of {total}: {title}",
  "announce.stepChangeNoTitle": "Step {current} of {total}",
  "announce.branchAdded.one": "1 question was added below.",
  "announce.branchAdded.other": "{count} questions were added below.",
  "announce.branchRemoved.one": "1 question was removed.",
  "announce.branchRemoved.other": "{count} questions were removed.",
  // Announced when the last answer completes the step and the flow collapses to
  // the ready-to-submit state (currentStep becomes null): clearer than reporting
  // the now-hidden questions as a bulk removal.
  "announce.ready": "You have answered everything. You can now submit.",

  "link.expired.title": "This link has expired",
  "link.expired.body": "The registration link is no longer valid. Please request a new one.",
  "link.consumed.title": "This link has already been used",
  "link.consumed.body":
    "Each secure link can be opened once. Please request a new link to continue.",
  "link.revoked.title": "This link is no longer active",
  "link.revoked.body":
    "The registration link was withdrawn. Please contact whoever sent it to you.",

  "link.invalid.title": "This link is not valid",
  "link.invalid.body":
    "The registration link could not be read. Please check the link or request a new one.",

  "formClosed.title": "This form is not accepting responses",
  "formClosed.body": "The questionnaire is closed. Please check back later or contact the sender.",
  "formUnavailable.title": "This form is not available",
  "formUnavailable.body":
    "We could not open the questionnaire. Please try again later or contact the sender.",

  // The ADR-16 semantics refusal (issue #743, from the typed 409 the serve and
  // answer routes return): this build cannot evaluate the version the session is
  // pinned to, so the questionnaire has to be republished before anyone can
  // continue. Unreachable while SEMANTICS_VERSION is 1 - written ahead of the
  // bump, which is the day nobody wants to be writing respondent copy in a hurry.
  //
  // It says "try again" nowhere on purpose. The refusal is a 409: a retry against
  // the same deployment gets the same answer, so inviting one would send a
  // respondent round a loop that cannot end. It names no version, no stamp and no
  // internal vocabulary either - "semantics version" is a fact about our
  // evaluator, not information a respondent can act on. What they CAN act on is
  // the one line that follows: tell whoever sent it.
  "formSuperseded.title": "This form needs to be republished",
  "formSuperseded.body":
    "This questionnaire was published by an earlier version of the service and can no longer be filled in. Your answers so far are safe. Please contact whoever sent you this form.",

  // `recovery.action` ("Start again") stood here until issue #756's sweep. The screen it
  // was written for renders a `MessageScreen` with a title and a body and no action at
  // all (`app/s/[sessionId]/page.tsx`), and it cannot grow one that says this: a session
  // that could not be resumed has no link left to start from, which is exactly what
  // `recovery.body` tells the respondent to go and find. If the screen ever gains a
  // button, the key comes back beside it.
  "recovery.title": "We could not resume your session",
  "recovery.body": "Your session may have ended. You can start again from the form link.",

  "expired.title": "Your session has expired",
  "expired.body": "For your privacy, sessions end after a period of inactivity.",

  "completion.title": "Thank you, your responses were received",
  "completion.body": "You may now close this page.",
  "completion.submittedAt": "Submitted",
  // `completion.copy` ("Copy reference") stood here until issue #756's sweep.
  // `components/completion-view.tsx` renders the reference as selectable text with no
  // copy control beside it, and has since task 030. Whether a respondent should get a
  // copy button on the completion screen is a product question, not a catalog one; the
  // string comes back with the button that needs it.
  "completion.reference": "Reference",

  // The respondent appearance controls (task 053, ADR-30). "Spacing" rather than
  // "Density" for the visible label: density is the token contract's word for the
  // axis, not a word a respondent filling in a form should have to decode.
  "appearance.title": "Appearance",
  "appearance.mode.legend": "Colour mode",
  "appearance.mode.light": "Light",
  "appearance.mode.dark": "Dark",
  "appearance.mode.hc": "High contrast",
  "appearance.font.legend": "Font",
  "appearance.density.legend": "Spacing",
  "appearance.density.compact": "Compact",
  "appearance.density.comfortable": "Comfortable",
  "appearance.density.spacious": "Spacious",
  // The no-JS submit button (issue #195). Visible only when scripting is off, where
  // it is the only way the three choices above reach the server, so it names the
  // action rather than the control: "Apply appearance", not "Submit".
  "appearance.apply": "Apply appearance",
} as const;

export type MessageKey = keyof typeof messages;

/**
 * Resolve a catalog message, substituting `{name}` placeholders from `params`.
 * Missing params are left as their literal placeholder (visible in review).
 */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template = messages[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
