import { t, type MessageKey } from "../i18n/en.ts";

/**
 * The forms slice's API error codes, turned into sentences (task 033).
 *
 * The same contract 032's `questions/errors.ts` states, for the other half of the admin:
 * the API answers in stable codes and the screen owes the author a sentence that names
 * the **rule** rather than the symptom. `FORM_ID_TAKEN` on its own reads as a bug;
 * "an id is never reused for a different meaning" is the model the author needs (R6).
 *
 * Unrecognised codes fall back to a generic sentence carrying the raw code in small
 * print, so a build that meets a code it has never heard of still says something a bug
 * report can quote, and never puts machine text in front of a human as if it were prose.
 */

/** The codes the forms routes raise, mapped to the sentence explaining the rule. */
const FORM_CODE_MESSAGES: Readonly<Record<string, MessageKey>> = {
  INVALID_FORM_ID: "forms.error.invalidId",
  INVALID_DEFAULT_LOCALE: "forms.error.invalidLocale",
  FORM_ID_TAKEN: "forms.error.idTaken",
  FORM_NOT_FOUND: "forms.error.notFound",
  FORM_ID_MISMATCH: "forms.error.idMismatch",
  INVALID_FORM_DEFINITION: "forms.error.invalidDefinition",
  RULE_NOT_FOUND: "forms.error.ruleNotFound",
  INVALID_FORM_SETTINGS: "forms.error.invalidSettings",
  // 034's codes: publish, preview and the secure-link routes.
  NO_DRAFT: "forms.error.noDraft",
  PUBLISH_REJECTED: "forms.error.publishRejected",
  PREVIEW_REJECTED: "forms.error.previewRejected",
  PREVIEW_UNAVAILABLE: "forms.error.previewUnavailable",
  VERSION_NOT_FOUND: "forms.error.versionNotFound",
  INVALID_LINK_ID: "forms.error.invalidLinkId",
  LINK_NOT_FOUND: "forms.error.linkNotFound",
  LINK_EXPIRY_INVALID: "forms.error.linkExpiryInvalid",
  // 035's codes: the response, erasure and webhook-operations routes. They are read
  // through the same map because a screen has one error path, not two (`api-result.ts`).
  // 041 / issue #823: accepting a proposal that carried new question definitions.
  // These three come from the questions slice's authoring door, which the accept
  // route reuses, so they arrive on a forms screen and are read through this map.
  // Each takes the question id the envelope names, because the refusal is about one
  // question out of several and the whole accept was refused for it.
  INVALID_QUESTION_DEFINITION: "forms.error.proposedQuestionRefused",
  QUESTION_ID_REUSED: "forms.error.proposedQuestionIdReused",
  SLUG_TAKEN: "forms.error.proposedQuestionSlugTaken",
  INVALID_QUERY: "ops.error.invalidQuery",
  INVALID_SESSION_ID: "ops.error.invalidSessionId",
  RESPONSE_NOT_FOUND: "ops.error.responseNotFound",
  SESSION_NOT_FOUND: "ops.error.sessionNotFound",
  SUBMISSION_NOT_FOUND: "ops.error.submissionNotFound",
  WEBHOOK_NOT_FOUND: "ops.error.webhookNotFound",
  WEBHOOK_URL_REJECTED: "ops.error.webhookUrlRejected",
  DELIVERY_NOT_FOUND: "ops.error.deliveryNotFound",
  DELIVERY_NOT_REDELIVERABLE: "ops.error.deliveryNotRedeliverable",
  unauthorized: "forms.error.unauthorized",
  rate_limited: "forms.error.rateLimited",
  internal: "forms.error.internal",
};

/**
 * What an error envelope's `details` can name that the sentence needs (issue #823).
 *
 * `question` is the only one so far, and it exists because the accept refusals are
 * about one question out of a proposal listing several: a sentence that does not name
 * it leaves the operator to guess which. `reason` is the refusal the kernel or the
 * authoring boundary gave, already operator prose on the API side.
 */
export interface FormErrorContext {
  readonly question?: string | undefined;
  readonly reason?: string | undefined;
}

/** The human sentence for one forms API error code. */
export function messageForFormCode(code: string, context?: FormErrorContext): string {
  const key = FORM_CODE_MESSAGES[code];
  if (key === undefined) return t("forms.error.unknown", { code });
  return t(key, {
    // A message with no `{question}` placeholder ignores these; one that has it and is
    // handed nothing would render the literal brace, so the fallbacks are not padding.
    question: context?.question ?? code,
    reason: context?.reason ?? t("forms.error.internal"),
  });
}
