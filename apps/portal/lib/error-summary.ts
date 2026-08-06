import type { A2UIStepDocument } from "@qcms/ui";

import { t } from "./i18n/en";
import { authorMessageFor } from "./validation-message";
import { messagesOf, questionLabels } from "./visible";

/**
 * The error-summary entries for a blocked Continue/Submit (issue #21).
 *
 * Every entry used to render the same sentence, so all summary links had the same
 * accessible name and a screen-reader user could not tell which field each one
 * pointed at (WCAG 3.3.1, Error Identification). Each entry now names its own
 * question, taking the label from the compiled step document the portal already
 * holds (the compiler resolves `label` onto every control node at publish time,
 * ADR-18) - no API change, and no rule evaluation here (R2).
 *
 * An author who supplied a `required` message (task 048, ADR-32) replaces only
 * the SENTENCE BODY; the entry stays label-anchored. That is the whole point of
 * the composition: two questions carrying identical custom wording still produce
 * two distinct accessible names, because each is prefixed by its own label. A
 * label-less question (defensively - the compiler always resolves one) keeps
 * today's generic sentence rather than a bare custom message, so the summary can
 * never emit two indistinguishable entries.
 *
 * Order follows `missing`, which is the API's authoritative missing-required set
 * in document order, so the links read in the same order as the fields.
 */
export interface MissingRequiredEntry {
  /** The question this entry points at; the anchor target is `#<questionId>`. */
  readonly questionId: string;
  /** The link text, and therefore the link's accessible name. */
  readonly message: string;
}

export function missingRequiredEntries(
  document: A2UIStepDocument | null,
  missing: readonly string[],
): readonly MissingRequiredEntry[] {
  if (missing.length === 0) return [];
  const labels = document === null ? undefined : questionLabels(document);
  const messages = messagesOf(document);
  return missing.map((questionId) => {
    const label = labels?.get(questionId);
    const authored = authorMessageFor(messages.get(questionId), "required");
    let message: string;
    if (label === undefined) {
      message = t("errorSummary.missingRequired");
    } else if (authored === undefined) {
      message = t("errorSummary.missingRequiredNamed", { label });
    } else {
      message = t("errorSummary.namedCustom", { label, message: authored });
    }
    return { questionId, message };
  });
}
