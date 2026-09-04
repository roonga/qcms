import { t } from "@/lib/i18n/en";

/**
 * The agent-assisted provenance marker (task 041, ADR-25).
 *
 * Same shape as `StatusTag` (task 032) and the same reason: a plain span rather than
 * a kit component, because this is app chrome rather than a new variant of a vendored
 * control (ADR-22), and its one job - "the human publishing knows what they are
 * signing" - is entirely in its text. There is nothing here for colour to carry that
 * the words do not already say.
 *
 * Rendered in two places once a draft carries the marker: the builder's own header,
 * and 034's publish confirmation (`FormActions`) - the same fact, read from the same
 * source, wherever an author is about to act on the draft.
 */
export function AgentProvenanceTag() {
  return (
    <span className="qcms-tag qcms-tag--agent-assisted" data-testid="qcms-agent-provenance">
      {t("forms.assist.provenance")}
    </span>
  );
}
