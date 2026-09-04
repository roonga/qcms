/**
 * Portal shell message catalog (task 029) - owned source, single locale (en).
 *
 * Catalog structure per ADR-11: a flat map of dotted message keys to templates.
 * Only shell chrome lives here (buttons, progress text, error-page copy, receipt
 * labels). Question and step text is already resolved into the compiled A2UI at
 * publish time (ADR-18) and rendered by @qcms/ui, so it is never in this catalog.
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

  "recovery.title": "We could not resume your session",
  "recovery.body": "Your session may have ended. You can start again from the form link.",
  "recovery.action": "Start again",

  "expired.title": "Your session has expired",
  "expired.body": "For your privacy, sessions end after a period of inactivity.",

  "completion.title": "Thank you, your responses were received",
  "completion.body": "You may now close this page.",
  "completion.submittedAt": "Submitted",
  "completion.reference": "Reference",
  "completion.copy": "Copy reference",

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
