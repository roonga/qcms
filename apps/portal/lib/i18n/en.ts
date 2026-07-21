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
  "app.title": "QCMS",
  "app.description": "Complete your questionnaire.",

  "action.skipToContent": "Skip to content",
  "action.start": "Start",
  "action.back": "Back",
  "action.continue": "Continue",
  "action.submit": "Submit",

  "progress.step": "Step {current} of {total}",

  "entry.title": "You are invited to complete this form",
  "entry.startHint": "This should take a few minutes. Your answers are saved as you go.",

  "errorSummary.title": "Please fix the following before continuing",
  "errorSummary.missingRequired": "This question needs an answer.",
  "answer.invalid": "That answer is not valid.",
  "flow.submitReady": "You have answered everything. Submit your responses when you are ready.",
  "session.lost.title": "Something went wrong",
  "session.lost.body": "We could not reach the server. Please try again.",

  "branch.added": "1 question added",
  "branch.removed": "1 question removed",

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
