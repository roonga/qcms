/**
 * Portal shell message catalog (ADR-11), single locale.
 *
 * Shell chrome only: question and step text is resolved into the compiled A2UI at
 * publish time (ADR-18) and never appears here.
 */

export const messages = {
  // Only the fallback for a deployment that has not set `QCMS_PORTAL_BRAND_NAME`, and
  // generic on purpose: the engine's own name is not information a respondent needs.
  "brand.defaultName": "Questionnaire",
  "app.description": "Complete your questionnaire.",

  "action.skipToContent": "Skip to content",
  "action.start": "Start",
  "action.back": "Back",
  "action.continue": "Continue",
  "action.submit": "Submit",
  "action.retry": "Try again",

  "progress.step": "Step {current} of {total}",
  // The indicator counts views, so naming the instance is what keeps a paginated group's
  // pages legible as instances rather than as unrelated steps.
  "progress.stepNamed": "Step {current} of {total}: {label}",

  "home.body": "Open your questionnaire from the link you were sent.",

  "entry.title": "You are invited to complete this form",
  "entry.startHint": "This should take a few minutes. Your answers are saved as you go.",

  "errorSummary.title": "Please fix the following before continuing",
  // One template rather than a label concatenated with a message: word order and
  // punctuation around the label are a translator's decision (WCAG 3.3.1).
  "errorSummary.missingRequiredNamed": "{label} needs an answer.",
  // The sentence body `errorSummary.positional` names, and the last-resort wording for
  // an entry with neither a label nor a place on the page. Never an entry's whole name:
  // on its own it made every label-less entry byte-identical.
  "errorSummary.missingRequired": "This question needs an answer.",
  // No two questions share a position, so two label-less entries are distinct
  // structurally rather than because an author wrote distinct labels. "Question" is the
  // respondent's word for a field, matching the progress indicator's vocabulary.
  "errorSummary.positional": "Question {position}: {message}",
  // Only the separator is this catalogue's to translate; the message is the author's
  // (ADR-32) and is never modified.
  "errorSummary.namedCustom": "{label}: {message}",
  "answer.invalid": "That answer is not valid.",
  // The Add and Remove labels are not here: they are compiled into the stored document
  // from the compiler's lexicon, so a published form keeps the wording it was published
  // with (ADR-36's precedent).
  "errorSummary.inInstance": "{instance}: {message}",
  "repeat.maxReached": "You have added as many as this form allows.",
  "repeat.notAddable": "This part of the form is not one you can add to.",
  "repeat.failed": "We could not make that change. Please try again.",
  // Names no number, because the bound is the author's and the controls enforce it
  // either side of this round trip; what the respondent needs is to know the press was
  // refused and why.
  "repeat.countOutOfRange":
    "One of the repeated sections does not have enough entries to submit. Add the entries it needs and try again.",
  "repeat.added": "{label} added.",
  "repeat.removed": "{label} removed, {count} remaining.",
  "repeat.removedLast": "{label} removed, none remaining.",
  // The flow segment's error boundary, and not the deploy-skew landing, which no page of
  // this app can be (ADR-43). The body says what survived, because a respondent arriving
  // here has no other way to know.
  "repeat.staleStep.title": "This page was out of date",
  "repeat.staleStep.body":
    "We could not show that step. Every answer you had already saved is kept. Anything you typed on this step without saving will need typing again.",
  // `step.notSaved` has to say that nothing was saved, because the respondent is looking
  // at a step that still holds everything they typed and has no other way to tell.
  "step.countOutOfRange":
    "One of the repeated sections does not have enough entries to submit. Add the entries it needs and try again.",
  "step.notSaved":
    "We could not save your answers just now. Nothing was saved, and everything you typed is still here. Please press Continue again.",
  "flow.submitReady": "You have answered everything. Submit your responses when you are ready.",
  "session.lost.title": "Something went wrong",
  "session.lost.body": "We could not reach the server. Please try again.",

  // Live-region announcements: a branch change reports how many questions appeared or
  // disappeared, so it is perceivable to someone who cannot see the layout shift.
  "announce.stepChange": "Step {current} of {total}: {title}",
  "announce.stepChangeNoTitle": "Step {current} of {total}",
  "announce.branchAdded.one": "1 question was added below.",
  "announce.branchAdded.other": "{count} questions were added below.",
  "announce.branchRemoved.one": "1 question was removed.",
  "announce.branchRemoved.other": "{count} questions were removed.",
  // Clearer than reporting the now-hidden questions as a bulk removal.
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

  "formSuperseded.title": "This form needs to be republished",
  "formSuperseded.body":
    "This questionnaire was published by an earlier version of the service and can no longer be filled in. Your answers so far are safe. Please contact whoever sent you this form.",

  "recovery.title": "We could not resume your session",
  "recovery.body": "Your session may have ended. You can start again from the form link.",

  "expired.title": "Your session has expired",
  "expired.body": "For your privacy, sessions end after a period of inactivity.",

  "completion.title": "Thank you, your responses were received",
  "completion.body": "You may now close this page.",
  "completion.submittedAt": "Submitted",
  "completion.reference": "Reference",

  // "Spacing" rather than "Density" for the visible label: density is the token
  // contract's word for the axis, not one a respondent should have to decode.
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
  // Visible only when scripting is off, so it names the action rather than the control.
  "appearance.apply": "Apply appearance",
} as const;

export type MessageKey = keyof typeof messages;

// A missing param is left as its literal placeholder, so it is visible in review.
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template = messages[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
