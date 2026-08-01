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
  unauthorized: "forms.error.unauthorized",
  rate_limited: "forms.error.rateLimited",
  internal: "forms.error.internal",
};

/** The human sentence for one forms API error code. */
export function messageForFormCode(code: string): string {
  const key = FORM_CODE_MESSAGES[code];
  return key === undefined ? t("forms.error.unknown", { code }) : t(key);
}
